"""Busca IDs de premios de la barra de eventos ("Missions completed: N" -> premio) sin cobrar nada.

Mission/GetGroupRewardStepStatesV1 solo devuelve los IDs que EXISTEN (2026-11-15: con 30 Days of Gifts pedimos
_01.._04 y volvieron solo _01.._03). Patrón visto: MI_GR_RS_<AAMM>000_<NOMBRE>_<NN> (EVENT_04, 1STANNIVERSARY,
BEGINNER_01...). Solo lectura.

Uso: python -X utf8 buscar_premios_barra.py --engine-dir <ptcgp-capturedeluxe> --xml <cuenta.xml> [--desde 2601 --hasta 2612]
"""
import argparse, os, re, sys, time

NOMBRES = ([f"EVENT_{n:02d}" for n in range(1, 31)] + [f"EVENT{n:02d}" for n in range(1, 31)]
           + [f"{p}_{n:02d}" for p in ("PKW", "PREMIUM", "EMBLEM", "BONUS", "BONUSWEEK", "LOGIN", "SPECIAL", "PIKACHU",
                                        "GUARANTEED", "CAMPAIGN", "RETURN", "WELCOMEBACK", "COMEBACK", "MISSION")
              for n in range(1, 11)]
           + ["PKW", "PREMIUM", "BONUSWEEK", "LOGIN", "WELCOMEBACK", "COMEBACK", "RETURN"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine-dir", required=True)
    ap.add_argument("--xml", required=True)
    ap.add_argument("--desde", type=int, default=2601)
    ap.add_argument("--hasta", type=int, default=2612)
    ap.add_argument("--pasos", type=int, default=6)
    a = ap.parse_args()
    t = open(a.xml, encoding="utf-8", errors="ignore").read()
    u = re.search(r'name="deviceAccount">([^<]+)<', t).group(1).strip()
    p = re.search(r'name="devicePassword">([^<]+)<', t).group(1).strip()
    os.chdir(a.engine_dir)
    sys.path.insert(0, a.engine_dir)
    sys.path.insert(0, os.path.join(a.engine_dir, "engine"))
    import auto_trade as at
    from engine.takasho.schema.lettuce_server.player_api import mission_get_group_reward_step_states_v1_pb2 as st
    sess = at.login_bot(u, p, proxy_url=None, max_retries=3)

    def preguntar(ids):
        req = st.MissionGetGroupRewardStepStatesV1.Types.Request()
        req.mission_group_reward_step_ids.extend(ids)
        try:
            r = sess._call("/takasho.schema.lettuce_server.player_api.Mission/GetGroupRewardStepStatesV1", req,
                           st.MissionGetGroupRewardStepStatesV1.Types.Response)
            return [(x.mission_group_reward_step_id, x.is_cleared) for x in r.states], None
        except Exception as e:
            return None, str(e)[:120]

    print("control:", preguntar(["MI_GR_RS_2602000_EVENT_04_01", "MI_GR_RS_2602000_EVENT_04_09"]), flush=True)
    periodos = []
    aa, mm = divmod(a.desde, 100)
    while aa * 100 + mm <= a.hasta:
        periodos.append(f"{aa:02d}{mm:02d}")
        mm += 1
        if mm > 12:
            aa, mm = aa + 1, 1
    extra = ["GUARANTEE", "GUARANTEED", "STAR2", "2STAR", "TWOSTAR", "RARE", "BOOSTER", "PACK", "CARD", "COLLECT",
             "LIMITED", "EVENT", "PICKUP", "SUPPORT", "BEGINNER", "DAILY", "WEEKLY", "ANNIVERSARY", "CELEBRATION",
             "PROMO", "PREMIUMPASS", "PASS", "SHOP", "TICKET", "WONDER", "BATTLE", "RALLY", "SOLO", "PVP", "EMBLEM"]
    nombres = NOMBRES + [f"{x}_{n:02d}" for x in extra for n in range(1, 6)] + extra + [f"{g:02d}" for g in range(1, 31)]
    cand = [f"MI_GR_RS_{per}{suf}_{nom}_{k:02d}" for per in periodos for suf in ("000", "010")
            for nom in nombres for k in range(1, a.pasos + 1)]
    print("candidates:", len(cand), flush=True)
    hallados, errores = [], 0
    for i in range(0, len(cand), 300):
        res, err = preguntar(cand[i:i + 300])
        if res is None:
            errores += 1
            print("batch error", err, flush=True)
            continue
        if res:
            hallados += res
            print("found:", res, flush=True)
        time.sleep(0.3)
    print(f"done: {len(hallados)} found, {errores} errors", flush=True)


if __name__ == "__main__":
    main()
