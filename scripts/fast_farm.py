#!/usr/bin/env python3
"""
Fast Farm Tickets (2026-10-23, pedido de Ale): da un like a la Community Showcase de un perfil
desde varias cuentas XML, hablando directo con el servidor del juego a traves del bot nuevo
(ptcgp-capturedeluxe), sin MuMu ni needles. Cada like recibido le da 1 Shop Ticket al perfil.

Lo lanza fast-transfer.js y lee el progreso de stdout: una linea "@@FF {json}" por evento, y al
final "@@FF_RESULT {json}" con las cuentas que dieron el like. Las cuentas van de a una (el
login siempre sale de la IP de casa).

El like usa el mismo flujo que el GP Farm del bot nuevo (scripts/god_pack/likes.send_like):
GetSomeonesV1 -> OtherListV1 (friend code) -> LikeV1 (player id).

bot.js es quien decide que cuentas usar y anota en likes_dados las que dieron el like: este
script no guarda nada.

Uso:
    python -X utf8 fast_farm.py --engine-dir <ptcgp-capturedeluxe> --target 2549764884830011
        --account "101P_x|C:\\...\\101P_x.xml" --account "..." [--stop-file <ruta>]
"""
import argparse
import json
import os
import re
import sys


def emitir(**datos):
    print("@@FF " + json.dumps(datos, ensure_ascii=False), flush=True)


def leer_credenciales(xml_path):
    texto = open(xml_path, encoding="utf-8", errors="ignore").read()
    cuenta = re.search(r'name="deviceAccount">([^<]+)<', texto)
    clave = re.search(r'name="devicePassword">([^<]+)<', texto)
    if not cuenta or not clave:
        raise ValueError("deviceAccount/devicePassword not found in the XML")
    return cuenta.group(1).strip(), clave.group(1).strip()


def error_legible(err):
    s = str(err or "")
    if "datetime is out of alignment" in s:
        return "PC clock is out of sync — turn on automatic time in Windows"
    if "PERMISSION_DENIED" in s or "403" in s:
        return "IP temporarily blocked by the game — wait ~5 min or use a proxy"
    if "Connection refused" in s or "9090" in s:
        return "Tunnel is not running (port 9090)"
    if s.startswith("REJECTED"):
        return "The game rejected the like (this account may have liked this profile before)"
    return s[:200] or "unknown error"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--engine-dir", required=True)
    p.add_argument("--target", required=True)
    p.add_argument("--account", action="append", default=[], help="nombre|ruta_xml")
    p.add_argument("--stop-file", default="")
    p.add_argument("--proxy-file", default="", help="proxies del host: respaldo si el juego bloquea la IP")
    a = p.parse_args()
    import respaldo_proxy as rp
    proxies = rp.cargar(a.proxy_file)

    os.chdir(a.engine_dir)
    sys.path.insert(0, a.engine_dir)
    sys.path.insert(0, os.path.join(a.engine_dir, "engine"))
    import auto_trade as at
    from scripts.god_pack import likes

    codigo = re.sub(r"\D", "", a.target)
    pid_objetivo = None
    dieron_like = []

    for entrada in a.account:
        if a.stop_file and os.path.exists(a.stop_file):
            emitir(account="", state="stopped")
            break
        nombre, _, ruta = entrada.partition("|")
        emitir(account=nombre, state="start")
        # (Ale 2026-11-07) Si el juego bloquea la IP del host, se reintenta la cuenta por 1-2 proxies.
        plan = rp.intentos(proxies)
        for n_intento, proxy in enumerate(plan):
            ultimo = n_intento == len(plan) - 1
            if proxy:
                print(f"[proxy] IP blocked - retrying {nombre} through a proxy", flush=True)
            sess = None
            try:
                cuenta, clave = leer_credenciales(ruta)
                sess = at.login_bot(cuenta, clave, proxy_url=proxy, max_retries=1 if proxy else 3)
                if not pid_objetivo:
                    pid_objetivo = at.resolve_player_id(sess, codigo)
                ok, err = likes.send_like(sess, pid_objetivo, friend_code=codigo, tag=nombre,
                                          log_fn=lambda m: print(m, flush=True))
                if ok:
                    dieron_like.append(nombre)
                    emitir(account=nombre, state="ok")
                    break
                if rp.ip_bloqueada(err) and not ultimo:
                    continue
                emitir(account=nombre, state="error", msg=error_legible(err),
                       rejected=likes.is_server_rejection(err))
                break
            except Exception as e:
                if rp.ip_bloqueada(e) and not ultimo:
                    continue
                emitir(account=nombre, state="error", msg=error_legible(e))
                break
            finally:
                try:
                    if sess is not None and hasattr(sess, "close"):
                        sess.close()
                except Exception:
                    pass

    print("@@FF_RESULT " + json.dumps({"liked": dieron_like}, ensure_ascii=False), flush=True)
    return 0 if dieron_like else 1


if __name__ == "__main__":
    sys.exit(main())
