#!/usr/bin/env python3
"""
Fast Shinedust (2026-10-23, pedido de Ale): lee la Shinedust y los Shop Tickets de una o varias
cuentas XML preguntandole directo al servidor del juego (PlayerResources/SyncV1) a traves del
bot nuevo (ptcgp-capturedeluxe), sin MuMu ni OCR.

Lo lanza fast-transfer.js y lee el progreso de stdout: una linea "@@FD {json}" por cuenta.
Las cuentas van de a una, con una pausa entre logins (el login siempre sale de la IP de casa).
Si aparece --stop-file, termina la cuenta en curso y corta.

No escribe nada: bot.js guarda los valores en su propia base (los JSON son de Kevin/Leanny).

--with-cards (2026-10-24, sincronizar cartas): ademas baja QUE cartas tiene la cuenta en el juego
(sess.scan_account(), el mismo que usa sync_cards.py del bot de Miguel) y la manda en el evento
como "cards": [ids]. OJO: el juego no manda cuantas copias hay de cada una (card_amount viene
vacio aunque haya 3), asi que solo sirve para saber cuales tiene; bot.js corrige el JSON sin
tocar las cantidades. scan_account() deja sync_v1_page_*.json con los datos de la cuenta en la
carpeta del motor (modo depuracion de Miguel): se borran enseguida.

--with-gifts: cuenta los regalos pendientes del buzon ("gifts": N en el evento).
--claim: antes de leer, cobra los regalos del buzon y las misiones conocidas por el bot de Miguel
(principiante, especiales, decks de alquiler); "claimed": {gifts, missions}.
Errores: "transient": true si es pasajero (hora de la PC, IP, tunel, red); si no, la cuenta no
pudo entrar al juego (bot.js la marca con ⛔).

Uso:
    python -X utf8 fast_dust.py --engine-dir <ptcgp-capturedeluxe>
        --accounts-file cuentas.json [--delay 2] [--stop-file <ruta>]
    cuentas.json = [{"key": "<archivo json>", "xml": "<ruta xml>"}, ...]
"""
import argparse
import glob
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


def es_transitorio(err):
    s = str(err or "")
    return any(x in s for x in ("datetime is out of alignment", "PERMISSION_DENIED", "403", "Connection refused", "9090",
                                "UNAVAILABLE", "DEADLINE_EXCEEDED", "timed out", "Timeout", "RESOURCE_EXHAUSTED", "502", "503"))


def contar_regalos(sess):
    from engine.takasho.schema.lettuce_server.player_api import present_box_list_v1_pb2
    total, token = 0, ""
    for _ in range(20):
        resp = sess._call("/takasho.schema.lettuce_server.player_api.PresentBox/ListV1",
                          present_box_list_v1_pb2.PresentBoxListV1.Types.Request(page_token=token),
                          present_box_list_v1_pb2.PresentBoxListV1.Types.Response)
        total += len(resp.presents)
        token = resp.next_page_token
        if not token:
            break
    return total


def misiones_conocidas():
    """IDs de misiones que conoce el flujo del bot de Miguel (no incluye las diarias)."""
    try:
        from scripts.full_flow_v2 import INITIAL_MISSION_ORDER, BEGINNER_DAILY_ORDER, SPECIAL_ORDER, RENTAL_ORDER
        return list(INITIAL_MISSION_ORDER) + list(BEGINNER_DAILY_ORDER) + list(SPECIAL_ORDER) + list(RENTAL_ORDER)
    except Exception:
        return []


def cobrar(sess):
    """Cobra el buzon de regalos y las misiones conocidas que esten completas."""
    regalos = 0
    r = sess.claim_presents()
    if r and r.get("success"):
        regalos = int(r.get("claimed_count", 0) or 0)
    misiones = 0
    ids = misiones_conocidas()
    if ids:
        try:
            from engine.takasho.schema.lettuce_server.player_api import mission_is_completed_v1_pb2
            req = mission_is_completed_v1_pb2.MissionIsCompletedV1.Types.Request()
            req.mission_ids.extend(ids)
            resp = sess._call("/takasho.schema.lettuce_server.player_api.Mission/IsCompletedV1", req,
                              mission_is_completed_v1_pb2.MissionIsCompletedV1.Types.Response)
            for mid in [m.mission_id for m in resp.completed_missions]:
                rc = sess.complete_missions([mid])  # de a una: las ya cobradas fallan sin cortar el resto
                if rc and rc.get("success"):
                    misiones += 1
        except Exception:
            pass
    return {"gifts": regalos, "missions": misiones}


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
    p.add_argument("--with-cards", action="store_true")
    p.add_argument("--with-gifts", action="store_true")
    p.add_argument("--claim", action="store_true")
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
            cobrado = cobrar(sess) if a.claim else None
            inv = leer_inventario(sess)
            cartas = None
            if a.with_cards:
                try:
                    scan = sess.scan_account()
                    if scan and scan.get("success"):
                        cartas = sorted({x.get("card_id") for x in scan.get("cards") or [] if x.get("card_id")})
                except Exception:
                    cartas = None  # el Shinedust igual sirve aunque la coleccion falle
                finally:
                    for basura in glob.glob(os.path.join(os.getcwd(), "sync_v1_page_*.json")):
                        try:
                            os.remove(basura)
                        except OSError:
                            pass
            regalos = None
            if a.with_gifts or a.claim:
                try:
                    regalos = contar_regalos(sess)
                except Exception:
                    regalos = None
            emitir(key=c["key"], state="ok", dust=inv["dust"], tickets=inv["shopticket"], inv=inv, cards=cartas,
                   gifts=regalos, claimed=cobrado)
        except Exception as e:
            emitir(key=c["key"], state="error", msg=error_legible(e), transient=es_transitorio(e))
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
