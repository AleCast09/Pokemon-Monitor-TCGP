#!/usr/bin/env python3
"""
Fast Share / Fast Trade (2026-10-23, pedido de Ale): hace UN share o UN trade desde una cuenta
XML hacia la Main, hablando directo con el servidor del juego a traves del bot nuevo
(ptcgp-capturedeluxe), sin MuMu ni needles.

No es interactivo: lo lanza fast-transfer.js y lee el progreso de stdout. Cada evento es una
linea "@@FT {json}"; todo lo demas es log crudo del motor.

Cancelar (boton Cancel de Discord): fast-transfer.js crea el archivo --stop-file. Apenas aparece,
se corta la espera en curso y se deshace lo empezado: trade abierto rechazado, solicitud de
amistad retirada y amistad borrada.

NUNCA escribe los JSON de cuentas (son de la herramienta de Kevin/Leanny): el historial lo
guarda bot.js en su propia tabla de transferencias.

Uso:
    python -X utf8 fast_transfer.py --engine-dir <ptcgp-capturedeluxe> --xml <cuenta.xml>
        --card-id PK_10_017410_00 --target 2549-7648-8483-0011 --mode share|trade
        [--proxy-file proxies.txt] [--stop-file <ruta>]
"""
import argparse
import json
import os
import re
import sys
import time


class Cancelado(Exception):
    pass


ESTADO = {"stop_file": "", "limpiando": False}


def cancelacion_pedida():
    return bool(ESTADO["stop_file"]) and os.path.exists(ESTADO["stop_file"])


def revisar_cancelacion():
    if not ESTADO["limpiando"] and cancelacion_pedida():
        raise Cancelado()


def dormir(segundos):
    """sleep en pedazos cortos para reaccionar rapido al Cancel."""
    fin = time.time() + segundos
    while True:
        revisar_cancelacion()
        resto = fin - time.time()
        if resto <= 0:
            return
        time.sleep(min(0.5, resto))


class _TiempoCancelable:
    """Reemplaza el modulo time dentro de auto_trade: sus esperas (amistad, trade) cortan al
    pedir Cancel. Todo lo demas pasa al time real."""
    def __getattr__(self, nombre):
        return getattr(time, nombre)

    def sleep(self, segundos):
        dormir(segundos)


def emitir(paso, estado, msg=""):
    print("@@FT " + json.dumps({"step": paso, "state": estado, "msg": msg}, ensure_ascii=False), flush=True)


def leer_credenciales(xml_path):
    texto = open(xml_path, encoding="utf-8", errors="ignore").read()
    cuenta = re.search(r'name="deviceAccount">([^<]+)<', texto)
    clave = re.search(r'name="devicePassword">([^<]+)<', texto)
    if not cuenta or not clave:
        raise ValueError("deviceAccount/devicePassword not found in the XML")
    return cuenta.group(1).strip(), clave.group(1).strip()


def error_legible(err):
    """Traduce los errores conocidos del motor a una causa corta para Discord."""
    s = str(err or "")
    if "datetime is out of alignment" in s:
        return "PC clock is out of sync — turn on automatic time in Windows"
    if "PERMISSION_DENIED" in s or "403" in s:
        return "IP temporarily blocked by the game — wait ~5 min or use a proxy"
    if "Connection refused" in s or "9090" in s:
        return "Tunnel is not running (port 9090)"
    return s[:300] or "unknown error"


def deshacer(at, sess, pid):
    """Cancel: deja la cuenta como estaba antes de empezar."""
    ESTADO["limpiando"] = True
    emitir("cancel", "start", "Undoing what was started…")
    hecho = []
    try:
        # Rechaza el trade abierto, solo si de verdad habia uno.
        r = sess.get_trade()
        ts = r.get("trade_state") if r.get("success") else None
        if ts is not None and getattr(getattr(ts, "trade_session", None), "session_id", ""):
            at.cleanup_stale_sessions(sess)
            hecho.append("open trade closed")
    except Exception:
        pass
    if pid:
        try:
            sess.cancel_sent_friend_requests([pid])
            hecho.append("friend request withdrawn")
        except Exception:
            pass
        try:
            if at.is_friend(sess, pid):
                at.unfriend(sess, pid)
                hecho.append("unfriended")
        except Exception:
            pass
    emitir("cancel", "ok", ", ".join(hecho) or "nothing to undo")


LIMITE_AMIGOS = 90  # el juego deja 99; con margen para la solicitud a la Main


def _pids(items):
    """player_id de cada amigo / solicitud (como fr_cleanup.py del bot de Miguel)."""
    out = set()
    for it in items or []:
        pid = getattr(it, "player_id", "") or ""
        if not pid:
            inner = getattr(it, "player", None)
            pid = getattr(inner, "player_id", "") or ""
        if pid:
            out.add(pid)
    return out


def limpiar_amigos_si_hace_falta(sess, pid_main):
    """Limpiar amigos (2026-10-24): si la cuenta esta casi llena de amigos y solicitudes enviadas,
    se borran (menos la Main) antes de mandar la solicitud, para que el trade no falle por el limite."""
    try:
        fl = sess.get_friend_list()
        if not fl.get("success"):
            return
        amigos = _pids(fl.get("friends")) - {pid_main}
        enviadas = _pids(fl.get("sent_requests")) - {pid_main}
        if len(amigos) + len(enviadas) < LIMITE_AMIGOS:
            return
        if enviadas:
            sess.cancel_sent_friend_requests(sorted(enviadas))
        if amigos:
            sess.delete_friends(sorted(amigos))
        emitir("friend_request", "start", f"cleaned {len(amigos)} friends and {len(enviadas)} pending requests")
    except Exception:
        pass  # si no se puede limpiar, se intenta igual


def idiomas_de_cartas(sess):
    """{card_id: [lang, ...]} con los idiomas de las copias que la cuenta tiene de verdad
    (PlayerResources/SyncV1 paginado -> card_stocks[].language_tags; amount 0 = 1 copia, como
    card_amount). Ordenado: mas copias primero."""
    mapa = {}
    try:
        from engine.takasho.schema.lettuce_server.player_api import player_resources_sync_v1_pb2 as ps
        cursor = ""
        for _ in range(50):
            resp = sess._call(
                "/takasho.schema.lettuce_server.player_api.PlayerResources/SyncV1",
                ps.PlayerResourcesSyncV1.Types.Request(cursor=cursor),
                ps.PlayerResourcesSyncV1.Types.Response,
            )
            for st in resp.player_resources.card_stocks:
                tags = sorted(((int(t.lang), max(1, int(t.amount))) for t in st.language_tags), key=lambda x: -x[1])
                if tags:
                    mapa[st.card_id] = [l for l, _ in tags]
            if not resp.has_next:
                break
            cursor = resp.next_cursor
    except Exception as e:
        print(f"  [Lang] could not read card languages: {e}", flush=True)
    return mapa


def usar_idioma_de_la_cuenta(at, sess):
    """Idioma de la carta. El motor ofrece/comparte siempre en ingles (lang=2) y el juego rechaza
    el trade (ABORTED 4008) si la copia es de otro idioma.
    - 2026-10-24: se usaba el idioma del juego de la cuenta.
    - 2026-11-10: no alcanza -- la cuenta bd1118 de creeeder91 tiene el juego en ingles pero sus
      cartas en espanol (Cyrus/Mimikyu fallaban con 4008, a mano funcionaba). Ahora se usa el idioma
      de la copia que la cuenta tiene de esa carta; si no se sabe, el del juego."""
    try:
        lang_juego = int(sess.get_player_settings().get("language_type") or 0)
    except Exception:
        lang_juego = 0
    por_carta = idiomas_de_cartas(sess)

    def idioma(card_id):
        langs = por_carta.get(card_id) or []
        if lang_juego > 0 and lang_juego in langs:
            return lang_juego
        if langs:
            return langs[0]
        return lang_juego if lang_juego > 0 else 2

    original = sess.submit_trade_proposal

    def submit_con_idioma(*args, **kw):
        card_id = kw.get("card_id") or (args[1] if len(args) > 1 else "")
        kw["lang"] = idioma(card_id)
        print(f"  [Lang] offering {card_id} in language {kw['lang']}", flush=True)
        return original(*args, **kw)

    sess.submit_trade_proposal = submit_con_idioma
    if lang_juego > 0 and lang_juego != 2:
        at.LANG_ENUM = dict(at.LANG_ENUM, EN=lang_juego)  # run_share_flow pide "EN" fijo
        print(f"  [Lang] account language {lang_juego} (not EN)", flush=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--engine-dir", required=True)
    p.add_argument("--xml", required=True)
    p.add_argument("--card-id", default="")
    # Trades masivos (2026-10-24, god packs): varias cartas separadas por coma, un solo login y una
    # sola amistad; cada trade igual lo acepta la Main en el juego.
    p.add_argument("--card-ids", default="")
    p.add_argument("--target", required=True)
    p.add_argument("--mode", choices=["share", "trade"], required=True)
    p.add_argument("--proxy-file", default="")
    p.add_argument("--backup-proxy-file", default="", help="proxies del host: respaldo si el juego bloquea la IP al entrar")
    p.add_argument("--stop-file", default="")
    a = p.parse_args()
    ESTADO["stop_file"] = a.stop_file

    os.chdir(a.engine_dir)
    sys.path.insert(0, a.engine_dir)
    sys.path.insert(0, os.path.join(a.engine_dir, "engine"))
    import auto_trade as at
    at.time = _TiempoCancelable()

    # run_trade() informa todo con print(): se intercepta para convertir sus lineas en pasos.
    print_real = print
    # "motivo": la ultima linea de error que imprimio run_trade (no lo devuelve; solo lo imprime).
    estado_trade = {"esperando": False, "motivo": ""}

    def print_trade(*args, **kw):
        linea = " ".join(str(x) for x in args)
        print_real(linea, flush=True)
        if ESTADO["limpiando"]:
            return
        if "[Trade]" in linea and any(x in linea for x in ("✗", "⚠", "error", "Error", "failed", "Failed", "not enough", "insufficient")):
            estado_trade["motivo"] = linea.split("[Trade]", 1)[-1].replace("✗", "").replace("⚠", "").strip()[:200]
        if "requires" in linea and "shiny dust" in linea:
            estado_trade["costo"] = linea.split("[Trade]", 1)[-1].strip()[:120]
        if "No trade power" in linea:
            ESTADO["sin_energia"] = True
            emitir("offer", "error", "This account has no trade energy left (1 per day, max 5)")
        elif "not in tradeable friends" in linea:
            emitir("offer", "error", "Your Main is not in this account's tradeable friends list")
        elif "Proposal sent" in linea:
            emitir("offer", "ok")
            emitir("trade_accept", "wait", "Offer a card from your Main and accept the trade")
            estado_trade["esperando"] = True
        elif "✓ Accepted!" in linea and estado_trade["esperando"]:
            emitir("trade_accept", "ok")
            emitir("confirm", "start")
        elif "cancelled" in linea.lower() or "rejected" in linea.lower():
            emitir("trade_accept", "error", "The trade was cancelled or rejected")
        elif "Timed out" in linea:
            emitir("trade_accept", "error", "Timed out waiting for the trade")
    at.print = print_trade

    if a.proxy_file:
        at.load_proxy_list(a.proxy_file)

    # Carta: nombre, rareza y costo de Shinedust desde la base del motor.
    db = at.load_card_database()

    def info_carta(card_id):
        info = next((c for c in db if at.extract_card_id(c.get("image", "")) == card_id), None)
        rar = ((info or {}).get("rarity", "") or "").upper()
        return {
            "card_id": card_id,
            "name": (info or {}).get("name", card_id),
            "set": (info or {}).get("set", ""),
            "rarity": rar or "?",
            "trade_price": at.get_trade_price(rar) if rar else 0,
        }

    cartas = [c.strip() for c in (a.card_ids or a.card_id).split(",") if c.strip()]
    if not cartas:
        emitir("login", "error", "No card given")
        return 1
    card_info = info_carta(cartas[0])
    rareza = card_info["rarity"] if card_info["rarity"] != "?" else ""
    if a.mode == "share" and rareza and not at.is_shareable(rareza):
        emitir("login", "error", f"Rarity {rareza} can't be shared (only 1◇–4◇)")
        return 1

    try:
        cuenta, clave = leer_credenciales(a.xml)
    except Exception as e:
        emitir("login", "error", f"Bad XML: {e}")
        return 1

    if cancelacion_pedida():
        emitir("cancel", "ok", "nothing to undo")
        return 2
    emitir("login", "start")
    # (Ale 2026-11-07) Si el juego bloquea la IP del host AL ENTRAR, se reintenta el login por 1-2 proxies
    # del host. Solo el login: todavia no se mando ninguna carta, asi que nunca se repite un trade.
    import respaldo_proxy as rp
    plan = rp.intentos(rp.cargar(a.backup_proxy_file))
    sess = None
    for n_intento, proxy in enumerate(plan):
        try:
            if proxy:
                print("[proxy] IP blocked - logging in through a proxy", flush=True)
            sess = at.login_bot(cuenta, clave, proxy_url=proxy, max_retries=1 if proxy else 3)
            break
        except Cancelado:
            emitir("cancel", "ok", "nothing to undo")
            return 2
        except Exception as e:
            if rp.ip_bloqueada(e) and n_intento < len(plan) - 1:
                continue
            emitir("login", "error", error_legible(e))
            return 1
    emitir("login", "ok", getattr(sess, "nickname", "") or "")
    usar_idioma_de_la_cuenta(at, sess)

    pid = None
    try:
        revisar_cancelacion()
        try:
            at.cleanup_stale_sessions(sess)
        except Cancelado:
            raise
        except Exception:
            pass

        try:
            pid = at.resolve_player_id(sess, a.target)
        except Cancelado:
            raise
        except Exception as e:
            emitir("friend_request", "error", f"Could not find your Main: {error_legible(e)}")
            return 1

        # Amistad: solicitud + espera a que la Main acepte (5 min, igual que el motor).
        emitir("friend_request", "start")
        try:
            if at.is_friend(sess, pid):
                emitir("friend_request", "ok", "already friends")
                emitir("accept", "ok")
            else:
                limpiar_amigos_si_hace_falta(sess, pid)
                sess.send_friend_requests([pid])
                emitir("friend_request", "ok")
                emitir("accept", "wait", "Accept the friend request on your Main")
                inicio = time.time()
                aceptada = False
                while time.time() - inicio < at.FRIEND_POLL_TIMEOUT:
                    dormir(at.FRIEND_POLL_INTERVAL)
                    if at.is_friend(sess, pid):
                        aceptada = True
                        break
                if not aceptada:
                    emitir("accept", "error", "Your Main didn't accept the friend request in 5 min")
                    deshacer(at, sess, pid)
                    return 1
                emitir("accept", "ok")
        except Cancelado:
            raise
        except Exception as e:
            emitir("friend_request", "error", error_legible(e))
            return 1
        dormir(5)

        exito = False
        recibida = ""
        if a.mode == "share":
            emitir("share", "start")
            try:
                r = at.run_share_flow(sess, pid, card_info, log_fn=lambda m: print_real(m, flush=True))
                exito = bool(r.get("success"))
                if exito:
                    emitir("share", "ok")
                else:
                    err = str(r.get("error") or "")
                    if err.startswith("quota/limit") or "already" in err.lower():
                        emitir("share", "error", "Your Main already received a share today (1 per day)")
                    elif err.startswith("feature locked"):
                        emitir("share", "error", "Share is locked on this account (it may be too new)")
                    else:
                        emitir("share", "error", error_legible(err))
            except Cancelado:
                raise
            except Exception as e:
                emitir("share", "error", error_legible(e))
        else:
            resultados = []
            for n, card_id in enumerate(cartas):
                card_info = info_carta(card_id)
                estado_trade["esperando"] = False
                if len(cartas) > 1:
                    if n > 0:
                        dormir(5)
                    emitir("card", "start", card_id)
                ok_carta = False
                recibida = ""
                estado_trade["motivo"] = ""
                estado_trade["costo"] = ""
                emitir("offer", "start")
                try:
                    outcome = at.run_trade(sess, pid, card_info)
                    ok_carta = bool(outcome and outcome.get("success"))
                    if ok_carta:
                        try:
                            resp = outcome.get("response")
                            recibida = getattr(resp.outcome, "card_id", "") or "" if resp and resp.outcome else ""
                        except Exception:
                            recibida = ""
                        emitir("confirm", "ok", recibida)
                        try:
                            dormir(2)
                            at.send_thanks(sess, pid)
                        except Cancelado:
                            pass  # el trade ya se hizo: no hay nada que deshacer
                        except Exception:
                            pass
                    elif estado_trade["esperando"]:
                        emitir("confirm", "error", estado_trade["motivo"] or "Trade did not complete")
                    else:
                        # El motivo real del motor (por ejemplo, sin Shinedust para el costo del trade).
                        motivo = estado_trade["motivo"] or "Could not send the trade offer"
                        if estado_trade.get("costo") and "dust" not in motivo.lower():
                            motivo += f" ({estado_trade['costo']})"
                        emitir("offer", "error", motivo)
                except Cancelado:
                    raise
                except Exception as e:
                    emitir("offer", "error", error_legible(e))
                resultados.append({"card": card_id, "ok": ok_carta, "received": recibida})
                if len(cartas) > 1:
                    emitir("card", "ok" if ok_carta else "error", f"{card_id}|{recibida}")
                if not ok_carta and ESTADO.get("sin_energia"):
                    break  # sin energia de trade no tiene sentido seguir con las demas
            exito = any(r["ok"] for r in resultados)
            ESTADO["resultados"] = resultados
    except Cancelado:
        deshacer(at, sess, pid)
        print_real("@@FT_RESULT " + json.dumps({"success": False, "cancelled": True}), flush=True)
        return 2

    # Cierre normal: quitar la amistad (tambien si el share/trade fallo).
    ESTADO["limpiando"] = True
    emitir("unfriend", "start")
    try:
        time.sleep(2)
        at.unfriend(sess, pid)
        emitir("unfriend", "ok")
    except Exception as e:
        emitir("unfriend", "error", error_legible(e))

    print_real("@@FT_RESULT " + json.dumps({"success": exito, "received": recibida, "results": ESTADO.get("resultados", [])}), flush=True)
    return 0 if exito else 1


if __name__ == "__main__":
    sys.exit(main())
