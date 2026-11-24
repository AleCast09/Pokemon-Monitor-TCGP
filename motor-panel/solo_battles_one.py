#!/usr/bin/env python3
"""SOLO_BATTLES_V1 (Ale/Arcade 2026-11-24): solo battles for ONE account, through its proxy.

Started by inject.py --solo-battles (God Pack UI button "Solo battles - your accounts"), one process per account.
Uses scripts/sweep_solo_battles_v2.py (the battles of the account-creation flow): stepup battles first (first-clear
rewards and level-ups give hourglasses), then a few random battles. Works with accounts made in MuMu (tested on
Ale_Cast_177_6: BEGINNER_01 won, +36 hourglasses from the level-up).

Usage: python solo_battles_one.py --account-file <json with account_id/password> --proxy <url> [--max-random N]
The account file is written by inject.py in a temp folder and deleted right after.
"""
import argparse
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "engine"))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--account-file", required=True)
    p.add_argument("--proxy", default="")
    p.add_argument("--state-json", required=True)
    p.add_argument("--max-stepup", type=int, default=0)
    p.add_argument("--max-random", type=int, default=20)
    # The game answers HTML 403 (WAF) when battles start too fast on one IP (same as paying packs every 2-3 s,
    # HG_PACE_V1 in inject.py): 2 s between battles -> 403 after ~3. 15 s between battles by default.
    p.add_argument("--between-delay", type=float, default=15.0)
    a = p.parse_args()

    spec = importlib.util.spec_from_file_location("sweep", os.path.join(ROOT, "scripts", "sweep_solo_battles_v2.py"))
    sw = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sw)

    # The game refuses System/LoginV1 (INTERNAL) unless it carries the account's own settings (country, birth date,
    # age gate, data-use flags). The flow's re-login (after a 403 every few battles) sent fixed values (US/1995/
    # age gate A), failed, and the sweep stopped. Same fix as DAILY_LOGIN_V1 in inject.py.
    import scripts.flow.engine as fe
    from engine.takasho.schema.lettuce_server.player_api import (
        player_setting_get_info_v1_pb2 as _pg, system_login_v1_pb2 as _sl)

    def login_real(info, country, year):
        g = lambda k, d=None: getattr(info, k, d) if info is not None else d
        return _sl.SystemLoginV1.Types.Request(
            language_type=int(g("language_type", 2) or 2),
            third_party_data_provision_version_approved=g("third_party_data_provision_version", "") or "1.0.0",
            privacy_policy_consent_version_approved=g("privacy_policy_consent_version", "") or "1.1.0",
            terms_of_service_consent_version_approved=g("terms_of_service_consent_version", "") or "1.1.0",
            country_region_code=g("country_region_code", "") or country,
            year_num_of_birth=int(g("year_num_of_birth", 0) or year),
            month_num_of_birth=int(g("month_num_of_birth", 0) or 1),
            use_of_last_login_time=bool(g("use_of_last_login_time", True)),
            use_of_login_data=bool(g("use_of_login_data", True)),
            use_of_performance_errors=bool(g("use_of_performance_errors", True)),
            age_gate_type=int(g("age_gate_type", 1) or 1))
    fe.login_request = login_real

    original = sw.GameSession
    proxy = a.proxy

    def sesion(*args, **kw):
        if proxy:
            kw["proxy_url"] = proxy
        s = original(*args, **kw)
        login_orig = s.login

        def login(*la, **lk):
            r = login_orig(*la, **lk)
            if r.get("success"):
                try:
                    info = s._call("/takasho.schema.lettuce_server.player_api.PlayerSettings/GetInfoV1",
                                   _pg.PlayerSettingGetInfoV1.Types.Request(),
                                   _pg.PlayerSettingGetInfoV1.Types.Response).info
                    s._flow_login_info = info
                    s._flow_country = info.country_region_code or "US"
                    s._flow_year = int(info.year_num_of_birth or 1995)
                except Exception as exc:
                    print(f"[!] account settings not read: {str(exc)[:120]}", flush=True)
            return r
        s.login = login
        return s
    sw.GameSession = sesion
    argv = ["sweep", "--account-file", a.account_file, "--state-json", a.state_json,
            "--max-stepup", str(a.max_stepup), "--max-random", str(a.max_random),
            "--between-delay", str(a.between_delay)]
    if a.max_random <= 0:
        argv.append("--skip-random")
    sys.argv = argv
    sw.main()


if __name__ == "__main__":
    main()
