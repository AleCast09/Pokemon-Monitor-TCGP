#!/usr/bin/env python3
"""
Fast Shinedust (2026-10-23, pedido de Ale): lee la Shinedust y los Shop Tickets de una o varias
cuentas XML preguntandole directo al servidor del juego (PlayerResources/SyncV1) a traves del
bot nuevo (ptcgp-capturedeluxe), sin MuMu ni OCR.

Lo lanza fast-transfer.js y lee el progreso de stdout: una linea "@@FD {json}" por cuenta.
Las cuentas van de a una, con una pausa entre logins (el login siempre sale de la IP de casa).
Si aparece --stop-file, termina la cuenta en curso y corta.

No escribe nada: bot.js guarda los valores en su propia base (los JSON son de Kevin/Leanny).

Uso:
    python -X utf8 fast_dust.py --engine-dir <ptcgp-capturedeluxe>
        --accounts-file cuentas.json [--delay 2] [--stop-file <ruta>]
    cuentas.json = [{"key": "<archivo json>", "xml": "<ruta xml>"}, ...]
"""
import argparse
import json
import os
import re
import sys
import time


def emitir(**datos):
    print("@@FD " + json.dumps(datos, ensure_ascii=False), flush=True)


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
        return "PC clock is out of sync"
    if "PERMISSION_DENIED" in s or "403" in s:
        return "IP temporarily blocked by the game"
    if "Connection refused" in s or "9090" in s:
        return "Tunnel is not running (port 9090)"
    return s[:150] or "unknown error"


def leer_inventario(sess):
    """Inventario desde PlayerResources/SyncV1 (todo menos Poke Gold, que el juego no manda por
    aca: solo aparece al gastarlo o recibirlo, asi que sigue saliendo del OCR de MuMu)."""
    from google.protobuf.json_format import MessageToDict
    r = sess.sync_resources()
    if not r or not r.get("success"):
        raise RuntimeError(r.get("error") if isinstance(r, dict) else "sync_resources failed")
    resp = r.get("resp")
    d = MessageToDict(resp, preserving_proto_field_name=True) if hasattr(resp, "DESCRIPTOR") else (resp or {})
    pr = d.get("player_resources", {}) or {}

    def suma(lista):
        return sum(int(x.get("amount", 0) or 0) for x in (lista or []))

    monedas = {str(c.get("type", "")): int(c.get("amount", 0) or 0) for c in pr.get("currencies", []) or []}
    exp = pr.get("exp_stock", {}) or {}
    return {
        "dust": monedas.get("TYPE_BRIGHT_SAND", 0),
        "shopticket": monedas.get("TYPE_SHOP_TICKET", 0),
        "specialshopticket": monedas.get("TYPE_PREMIER_SHOP_TICKET", 0),
        "premiumticket": monedas.get("TYPE_SUBSCRIPTION_TICKET", 0),
        "packhourglass": suma(pr.get("pack_power_chargers")),
        "wonderhourglass": suma(pr.get("challenge_power_chargers")),
        "tradehourglass": suma(pr.get("trade_power_chargers")),
        "rewindwatch": suma(pr.get("revival_clocks")),
        "level": int(exp.get("current_level", 0) or 0),
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--engine-dir", required=True)
    p.add_argument("--accounts-file", required=True)
    p.add_argument("--delay", type=float, default=2.0)
    p.add_argument("--stop-file", default="")
    a = p.parse_args()

    cuentas = json.load(open(a.accounts_file, encoding="utf-8"))

    os.chdir(a.engine_dir)
    sys.path.insert(0, a.engine_dir)
    sys.path.insert(0, os.path.join(a.engine_dir, "engine"))
    import auto_trade as at

    for i, c in enumerate(cuentas):
        if a.stop_file and os.path.exists(a.stop_file):
            emitir(key="", state="stopped")
            break
        if i > 0 and a.delay > 0:
            time.sleep(a.delay)
        sess = None
        try:
            usuario, clave = leer_credenciales(c["xml"])
            sess = at.login_bot(usuario, clave)
            inv = leer_inventario(sess)
            emitir(key=c["key"], state="ok", dust=inv["dust"], tickets=inv["shopticket"], inv=inv)
        except Exception as e:
            emitir(key=c["key"], state="error", msg=error_legible(e))
        finally:
            try:
                if sess is not None and hasattr(sess, "close"):
                    sess.close()
            except Exception:
                pass

    print("@@FD_END", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
