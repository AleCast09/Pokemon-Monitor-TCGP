"""Busca IDs de misiones de evento que el motor no conoce (Ale 2026-11-15: Arcade, "Claim" no cobraba
"30 Days of Gifts" ni "Pika Pika! Pikachu Missions").

Solo LEE: entra con una cuenta y pregunta al servidor (Mission/IsCompletedV1) cuales de los IDs posibles
ya estan completos. No cobra nada. El patron sale de engine/config/eventMission.json del motor:
MI_AC_<AAMM>000_<grupo 01-15>_<numero 01-30 o 001-030>.

Uso (desde cualquier carpeta):
    python -X utf8 buscar_ids_evento.py --engine-dir <ptcgp-capturedeluxe> --xml <cuenta.xml>
        [--desde 2604] [--hasta 2611] [--salida ids.json]
"""
import argparse
import json
import os
import re
import sys
import time


def leer_credenciales(xml_path):
    texto = open(xml_path, encoding="utf-8", errors="ignore").read()
    cuenta = re.search(r'name="deviceAccount">([^<]+)<', texto)
    clave = re.search(r'name="devicePassword">([^<]+)<', texto)
    if not cuenta or not clave:
        raise ValueError("deviceAccount/devicePassword not found in the XML")
    return cuenta.group(1).strip(), clave.group(1).strip()


def periodos(desde, hasta):
    aa, mm = divmod(desde, 100)
    while aa * 100 + mm <= hasta:
        yield f"{aa:02d}{mm:02d}"
        mm += 1
        if mm > 12:
            aa, mm = aa + 1, 1


def candidatos(desde, hasta):
    for p in periodos(desde, hasta):
        for sufijo in ("000", "010"):
            for g in range(1, 16):
                for n in range(1, 31):
                    yield f"MI_AC_{p}{sufijo}_{g:02d}_{n:02d}"
                    yield f"MI_AC_{p}{sufijo}_{g:02d}_{n:03d}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine-dir", required=True)
    ap.add_argument("--xml", required=True)
    ap.add_argument("--desde", type=int, default=2604)
    ap.add_argument("--hasta", type=int, default=2611)
    ap.add_argument("--lote", type=int, default=300)
    ap.add_argument("--salida", default="")
    ap.add_argument("--conocidos", action="store_true", help="probar con los IDs de eventMission.json (control)")
    a = ap.parse_args()

    usuario, clave = leer_credenciales(a.xml)
    os.chdir(a.engine_dir)
    sys.path.insert(0, a.engine_dir)
    sys.path.insert(0, os.path.join(a.engine_dir, "engine"))
    import auto_trade as at
    from engine.takasho.schema.lettuce_server.player_api import mission_is_completed_v1_pb2 as mic

    sess = at.login_bot(usuario, clave, proxy_url=None, max_retries=3)
    url = "/takasho.schema.lettuce_server.player_api.Mission/IsCompletedV1"

    def preguntar(ids):
        req = mic.MissionIsCompletedV1.Types.Request()
        req.mission_ids.extend(ids)
        try:
            r = sess._call(url, req, mic.MissionIsCompletedV1.Types.Response)
            return {m.mission_id: m.last_completed_at.seconds for m in r.completed_missions}, None
        except Exception as e:
            return None, str(e)[:160]

    if a.conocidos:
        todos = [i for g in json.load(open(os.path.join(a.engine_dir, "engine", "config", "eventMission.json"), encoding="utf-8")) for i in g["ids"]]
    else:
        todos = list(candidatos(a.desde, a.hasta))
    print(f"candidates: {len(todos)}", flush=True)
    # Primero: el servidor acepta IDs que no existen? (uno conocido + uno inventado)
    _, err = preguntar(["MI_AC_2602000_06_01", "MI_AC_9912000_99_999"])
    print("fake id accepted:", err is None, err or "", flush=True)

    hallados, errores = {}, 0
    for i in range(0, len(todos), a.lote):
        lote = todos[i:i + a.lote]
        res, err = preguntar(lote)
        if res is None:
            errores += 1
            print(f"batch {i // a.lote}: error {err}", flush=True)
            continue
        hallados.update(res)
        if res:
            print(f"batch {i // a.lote}: " + ", ".join(sorted(res)), flush=True)
        time.sleep(0.4)
    print(f"done: {len(hallados)} completed id(s), {errores} batch error(s)", flush=True)
    if a.salida:
        json.dump(hallados, open(a.salida, "w", encoding="utf-8"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
