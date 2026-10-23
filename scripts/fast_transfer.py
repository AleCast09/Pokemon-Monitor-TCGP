#!/usr/bin/env python3
"""
Fast Share / Fast Trade (2026-10-23, pedido de Ale): hace UN share o UN trade desde una cuenta
XML hacia la Main, hablando directo con el servidor del juego a traves del bot nuevo
(ptcgp-capturedeluxe), sin MuMu ni needles.

No es interactivo: lo lanza fast-transfer.js y lee el progreso de stdout. Cada evento es una
linea "@@FT {json}"; todo lo demas es log crudo del motor.

NUNCA escribe los JSON de cuentas (son de la herramienta de Kevin/Leanny): el historial lo
guarda bot.js en su propia tabla de transferencias.

Uso:
    python -X utf8 fast_transfer.py --engine-dir <ptcgp-capturedeluxe> --xml <cuenta.xml>
        --card-id PK_10_017410_00 --target 2549-7648-8483-0011 --mode share|trade
        [--proxy-file proxies.txt]
"""
import argparse
import json
import os
import re
import sys
import time


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


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--engine-dir", required=True)
    p.add_argument("--xml", required=True)
    p.add_argument("--card-id", required=True)
    p.add_argument("--target", required=True)
    p.add_argument("--mode", choices=["share", "trade"], required=True)
    p.add_argument("--proxy-file", default="")
    a = p.parse_args()

    os.chdir(a.engine_dir)
    sys.path.insert(0, a.engine_dir)
    sys.path.insert(0, os.path.join(a.engine_dir, "engine"))
    import auto_trade as at

    # run_trade() informa todo con print(): se intercepta para convertir sus lineas en pasos.
    print_real = print
    estado_trade = {"esperando": False}

    def print_trade(*args, **kw):
        linea = " ".join(str(x) for x in args)
        print_real(linea, flush=True)
        if "No trade power" in linea:
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
    info = next((c for c in db if at.extract_card_id(c.get("image", "")) == a.card_id), None)
    rareza = ((info or {}).get("rarity", "") or "").upper()
    card_info = {
        "card_id": a.card_id,
        "name": (info or {}).get("name", a.card_id),
        "set": (info or {}).get("set", ""),
        "rarity": rareza or "?",
        "trade_price": at.get_trade_price(rareza) if rareza else 0,
    }
    if a.mode == "share" and rareza and not at.is_shareable(rareza):
        emitir("login", "error", f"Rarity {rareza} can't be shared (only 1◇–4◇)")
        return 1

    try:
        cuenta, clave = leer_credenciales(a.xml)
    except Exception as e:
        emitir("login", "error", f"Bad XML: {e}")
        return 1

    emitir("login", "start")
    try:
        sess = at.login_bot(cuenta, clave)
    except Exception as e:
        emitir("login", "error", error_legible(e))
        return 1
    emitir("login", "ok", getattr(sess, "nickname", "") or "")

    try:
        at.cleanup_stale_sessions(sess)
    except Exception:
        pass

    try:
        pid = at.resolve_player_id(sess, a.target)
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
            sess.send_friend_requests([pid])
            emitir("friend_request", "ok")
            emitir("accept", "wait", "Accept the friend request on your Main")
            inicio = time.time()
            aceptada = False
            while time.time() - inicio < at.FRIEND_POLL_TIMEOUT:
                time.sleep(at.FRIEND_POLL_INTERVAL)
                if at.is_friend(sess, pid):
                    aceptada = True
                    break
            if not aceptada:
                emitir("accept", "error", "Your Main didn't accept the friend request in 5 min")
                try:
                    at.unfriend(sess, pid)
                except Exception:
                    pass
                return 1
            emitir("accept", "ok")
    except Exception as e:
        emitir("friend_request", "error", error_legible(e))
        return 1
    time.sleep(5)

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
        except Exception as e:
            emitir("share", "error", error_legible(e))
    else:
        emitir("offer", "start")
        try:
            outcome = at.run_trade(sess, pid, card_info)
            exito = bool(outcome and outcome.get("success"))
            if exito:
                try:
                    resp = outcome.get("response")
                    recibida = getattr(resp.outcome, "card_id", "") or "" if resp and resp.outcome else ""
                except Exception:
                    recibida = ""
                emitir("confirm", "ok", recibida)
                try:
                    time.sleep(2)
                    at.send_thanks(sess, pid)
                except Exception:
                    pass
            elif estado_trade["esperando"]:
                emitir("confirm", "error", "Trade did not complete")
            else:
                emitir("offer", "error", "Could not send the trade offer")
        except Exception as e:
            emitir("offer", "error", error_legible(e))

    emitir("unfriend", "start")
    try:
        time.sleep(2)
        at.unfriend(sess, pid)
        emitir("unfriend", "ok")
    except Exception as e:
        emitir("unfriend", "error", error_legible(e))

    print_real("@@FT_RESULT " + json.dumps({"success": exito, "received": recibida}), flush=True)
    return 0 if exito else 1


if __name__ == "__main__":
    sys.exit(main())
