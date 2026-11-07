#!/usr/bin/env python3
"""
god_pack.inject — God Pack Wonder Pick injection over existing bot accounts.

Flow per account:
    1. Check cooldown — skip if JSON's metadata.lastPackPulled is younger
       than N hours (this field is written by PTCGPB-leannew when it opens
       packs; format: YYYYMMDDHHMMSS)
    2. Login (from XML deviceAccount+devicePassword, using proxy from proxies.txt)
    3. Resolve every collector friend code -> player_id UUID
    4. Send Friend/SendRequestsV1 to ALL collectors in one RPC
    5. Wait N seconds (user manually accepts on phone)
    6. Open N packs via PackShop/PurchaseV2
    7. Check each pack for the god-pack table (pack_table_id ends with _02)
    8. If ANY god pack: KEEP all friendships intact, log hit
       If NO god pack: send Friend/DeleteV1 for ALL collectors in one RPC
    9. Log the injection to reports/god_pack_state.json (we do NOT modify
       the account JSON — leannew owns lastPackPulled)
    10. Move to next account

Usage:
    python scripts\\god_pack\\inject.py \\
        --collector-codes "9370-0010-9308-6237,8280-6033-8091-6483" \\
        --packs 2 \\
        --pack-id BN010_0010_00_000 \\
        --product-id PC_PS_2608000_01_01_01 \\
        --proxy-file proxies.txt \\
        --cooldown-hours 24 \\
        --wait-accept 7 \\
        --parallel 1
"""
from __future__ import annotations

import argparse
import contextlib
import glob
import hashlib
import itertools
import io
import json
import os
import random
import re
import shutil
import sys
import threading
import time
import uuid
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
import pathlib
from typing import Optional

# ══════════════════════════════════════════════════════════════════════
# UTF-8 encoding setup for Windows charmap compatibility
# Fixes 'charmap' codec can't encode character errors on Windows
# More defensive for GUI environments (QProcess, etc.)
# ══════════════════════════════════════════════════════════════════════
if sys.platform == 'win32':
    try:
        # Only wrap if stdout/stderr are not already UTF-8 and have a buffer
        if hasattr(sys.stdout, 'buffer') and sys.stdout.encoding != 'utf-8':
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', write_through=True)
        if hasattr(sys.stderr, 'buffer') and sys.stderr.encoding != 'utf-8':
            sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', write_through=True)
    except (AttributeError, ValueError, OSError):
        pass  # Already wrapped, closed, or running in GUI/special environment

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "engine"))

from scripts.god_pack import state as gp_state  # noqa: E402
from scripts.god_pack import cards as gp_cards  # noqa: E402
from scripts.god_pack import json_writer as gp_json  # noqa: E402
from scripts.god_pack import fr_cleanup  # noqa: E402
from scripts.god_pack import likes as gp_likes  # noqa: E402
from scripts.god_pack import popups as gp_popups  # noqa: E402
from scripts.god_pack import resources as gp_resources  # noqa: E402

# ══════════════════════════════════════════════════════════════════════
# FR ledger (2026-11-07, Ale: Mains' friend lists filling up to 99 again)
# The engine's fr_cleanup.py ships the ledger as empty stubs, so an account cut off between "friend
# requests sent" and "links removed" (Stop, closing the panel, a bot restart/update, a crash) stayed a
# friend of every online Main forever. Real ledger: one file per account in reports/fr_pending/.
#   - Every inject.py writes reports/fr_pending/_alive_<run> every 30 s. Entries of a run that stopped
#     writing (2+ min) are leftovers; a sweep never touches accounts another running process still uses.
#   - Lent accounts (GP farm) never keep their XML on the host: only the owner + file name are stored, and
#     Monitor Pokemon asks the owner's Monitor Link for the XML again to clean them (--cleanup-only).
# ══════════════════════════════════════════════════════════════════════
FR_LEDGER_V1 = True
_FR_DIR = PROJECT_ROOT / "reports" / "fr_pending"
_RUN_ID = f"{os.getpid()}_{int(time.time())}"
_FR_ALIVE_STALE_SEC = 120
_fr_alive_started = False
_fr_lock = threading.Lock()
_SWEEP_XML_DIR = ""   # set by run_injection: lent entries are resolved against this folder


def _fr_owner() -> str:
    return os.environ.get("ZENITH_ACCOUNT_OWNER", "").strip()


def _fr_file(key: str, owner: str = None) -> Path:
    owner = _fr_owner() if owner is None else owner
    safe = re.sub(r"[^A-Za-z0-9_.()-]", "_", f"{owner}__{key}" if owner else key)
    return _FR_DIR / f"{safe}.json"


def _fr_alive_loop() -> None:
    while True:
        try:
            _FR_DIR.mkdir(parents=True, exist_ok=True)
            (_FR_DIR / f"_alive_{_RUN_ID}").write_text(str(time.time()), encoding="utf-8")
        except Exception:
            pass
        time.sleep(30)


def _fr_start_alive() -> None:
    global _fr_alive_started
    with _fr_lock:
        if _fr_alive_started:
            return
        _fr_alive_started = True
    threading.Thread(target=_fr_alive_loop, daemon=True).start()
    time.sleep(0.05)


def _fr_ledger_open(account: dict, target_pids: list) -> None:
    try:
        _fr_start_alive()
        owner = _fr_owner()
        xml_path = account.get("xml_path", "") or ""
        entry = {
            "account_key": account.get("account_key", ""), "nickname": account.get("nickname", ""),
            "account_id": account.get("account_id", ""), "target_pids": list(target_pids or []),
            "owner": owner, "xml_file": os.path.basename(xml_path),
            # a lent account's XML lives in a temporary folder: never store its path/credentials
            "xml_path": "" if owner else xml_path, "json_path": "" if owner else account.get("json_path", ""),
            "device_identifier": account.get("device_identifier", ""),
            "authorize_device_account": account.get("authorize_device_account", ""),
            "run": _RUN_ID, "ts": time.time(),
        }
        _FR_DIR.mkdir(parents=True, exist_ok=True)
        _fr_file(entry["account_key"]).write_text(json.dumps(entry), encoding="utf-8")
    except Exception:
        pass


def _fr_ledger_close(account_key: str) -> None:
    try:
        _fr_file(account_key).unlink()
    except Exception:
        pass


def _fr_run_alive(run: str) -> bool:
    if run == _RUN_ID:
        return True
    try:
        return time.time() - (_FR_DIR / f"_alive_{run}").stat().st_mtime < _FR_ALIVE_STALE_SEC
    except Exception:
        return False


def _fr_scan(scope: str = "all") -> dict:
    """scope: 'all', 'mine' (this process) or 'stale' (left by a process that is gone)."""
    out = {}
    try:
        files = list(_FR_DIR.glob("*.json"))
    except Exception:
        files = []
    for f in files:
        try:
            e = json.loads(f.read_text("utf-8"))
        except Exception:
            continue
        run = str(e.get("run", ""))
        if scope == "mine" and run != _RUN_ID:
            continue
        if scope == "stale" and _fr_run_alive(run):
            continue
        if time.time() - float(e.get("ts", 0) or 0) > 3 * 24 * 3600:   # gave up after 3 days (XML gone)
            try:
                f.unlink()
            except Exception:
                pass
            continue
        e["_file"] = str(f)
        out[f.stem] = e
    if scope != "mine":   # old heartbeat files of dead runs
        try:
            for a in _FR_DIR.glob("_alive_*"):
                if time.time() - a.stat().st_mtime > 24 * 3600:
                    a.unlink()
        except Exception:
            pass
    return out


fr_cleanup.ledger_open = _fr_ledger_open
fr_cleanup.ledger_close = _fr_ledger_close
fr_cleanup.ledger_entries = lambda: _fr_scan("all")
fr_cleanup.ledger_path = lambda: _FR_DIR

# 2026-11-07 (Ale): pulls[] must say the set code ("C1") like PTCGPB/Lean writes it. The engine wrote the raw
# pack id ("CN001_0020_00_000") and account viewers showed those packs as "undefined" with the wrong cards.
# The Monitor bot keeps reports/pack_sets.json {pack_id: set} from Leanny's packmaster; this is the fallback.
PACK_SET_CODES_V1 = True
_PACK_SETS = {
    "BN001_0010_00_000": "B1", "BN001_0020_00_000": "B1", "BN001_0030_00_000": "B1",
    "CN001_0010_00_000": "C1", "CN001_0020_00_000": "C1",
}
try:
    _PACK_SETS.update({str(k): str(v) for k, v in json.loads(
        (PROJECT_ROOT / "reports" / "pack_sets.json").read_text("utf-8")).items() if v})
except Exception:
    pass
_short_pack_name_engine = gp_json.short_pack_name


def _pack_set_code(pack_id: str) -> str:
    return _PACK_SETS.get(str(pack_id or "")) or _short_pack_name_engine(pack_id)


gp_json.short_pack_name = _pack_set_code   # json_writer looks it up at call time


def _fix_pack_labels(json_path: str, jdata) -> None:
    """Rewrite old pulls[] entries saved with the raw pack id to the set code (once per JSON)."""
    pulls = jdata.get("pulls") if isinstance(jdata, dict) else None
    if not json_path or not isinstance(pulls, list):
        return
    changed = 0
    for p in pulls:
        if isinstance(p, dict) and p.get("pack") in _PACK_SETS:
            p["pack"] = _PACK_SETS[p["pack"]]
            changed += 1
    if changed:
        gp_json._atomic_write_json(Path(json_path), jdata)
NOTIFIER_LOAD_CHECK_V1 = True
_gp_discord_error = ""


def _load_gp_discord():
    """2026-11-07 (Arcade's Mac): the engine's requirements.txt has no Pillow, so on a fresh install the God Pack
    notifier failed to import, was silently set to None and NO God Pack was ever posted. Now a missing module is
    installed once with pip (Pillow), and any other failure is kept so every God Pack logs why it wasn't posted."""
    global _gp_discord_error
    for attempt in range(2):
        try:
            from scripts.god_pack import discord_notifier as mod
            _gp_discord_error = ""
            return mod
        except ModuleNotFoundError as exc:
            _gp_discord_error = f"{exc}"
            missing = (getattr(exc, "name", "") or "").split(".")[0]
            pkg = {"PIL": "pillow", "google": "protobuf"}.get(missing, missing)
            if attempt or not pkg:
                break
            try:
                import subprocess
                subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", pkg],
                               timeout=300, check=False)
            except Exception:
                break
        except Exception as exc:
            _gp_discord_error = f"{type(exc).__name__}: {exc}"
            break
    return None


gp_discord = _load_gp_discord()


def _gp_notifier():
    """The notifier module, retrying the import when it failed at start (e.g. Pillow installed meanwhile)."""
    global gp_discord
    if gp_discord is None:
        gp_discord = _load_gp_discord()
    return gp_discord


# ══════════════════════════════════════════════════════════════════════
# Logging
# ══════════════════════════════════════════════════════════════════════

_log_lock = threading.Lock()
_log_file_handle = None  # opened once when --log-file is passed


def _rotate_log_file(p: Path, keep: int = 5) -> None:
    """
    Rotate <p> → <p>.1 → <p>.2 → ... → <p>.<keep>, discarding the oldest.
    Called before opening the log file fresh, so each run's classify lines
    survive the next run instead of being truncated away (which is what
    made the Sep 28 rocket god-pack diagnosis impossible after the fact).
    Best effort — a rotation failure never blocks the run.
    """
    try:
        if not p.exists():
            return
        # Drop the oldest slot first (path.5), then shift 4→5, 3→4, ...
        oldest = p.with_suffix(p.suffix + f".{keep}")
        try:
            if oldest.exists():
                oldest.unlink()
        except OSError:
            pass
        for i in range(keep - 1, 0, -1):
            src = p.with_suffix(p.suffix + f".{i}")
            dst = p.with_suffix(p.suffix + f".{i + 1}")
            if src.exists():
                try:
                    os.replace(str(src), str(dst))
                except OSError:
                    pass
        # Finally move the current file to .1
        try:
            os.replace(str(p), str(p.with_suffix(p.suffix + ".1")))
        except OSError:
            pass
    except Exception:
        pass


def _open_log_file(path: str):
    """Open a log file for tee output. Called once from run_injection."""
    global _log_file_handle
    if not path:
        return
    try:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        _rotate_log_file(p, keep=5)
        _log_file_handle = p.open("w", encoding="utf-8", buffering=1)  # line-buffered
    except Exception:
        _log_file_handle = None


def log(msg: str, tag: str = "") -> None:
    """Thread-safe timestamped log with Unicode fallback + optional file tee."""
    ts = time.strftime("%H:%M:%S")
    prefix = f"[{ts}]"
    if tag:
        prefix += f" [{tag}]"
    full_msg = f"{prefix} {msg}"
    with _log_lock:
        try:
            print(full_msg, flush=True)
        except (UnicodeEncodeError, ValueError):
            try:
                print(full_msg.encode('ascii', 'replace').decode('ascii'), flush=True)
            except Exception:
                try:
                    print(full_msg.encode('ascii', 'replace').decode('ascii'))
                except Exception:
                    pass
        # Tee to log file (raw, no filter) — this is what the PowerShell
        # tail window shows.
        if _log_file_handle is not None:
            try:
                _log_file_handle.write(full_msg + "\n")
                _log_file_handle.flush()
            except Exception:
                pass


# ══════════════════════════════════════════════════════════════════════
# Proxy pool
# ══════════════════════════════════════════════════════════════════════

_proxy_pool: list[str] = []
_proxy_index = 0
_proxy_lock = threading.Lock()
_proxy_bad_until: dict[str, float] = {}
_proxy_revive_seconds = 300
_proxy_checks = 3
_proxy_check_gap = 2.0
_proxy_rotations = 3
_proxy_health_file = PROJECT_ROOT / ".god_pack_bad_proxies.json"
_proxy_health_lock_file = PROJECT_ROOT / ".god_pack_bad_proxies.lock"


def load_proxies(path: Optional[str], scheme: str = "http") -> None:
    """Load proxies.txt into the global pool."""
    global _proxy_pool
    if not path or not os.path.isfile(path):
        _proxy_pool = []
        log(f"proxy file not found ({path}); running direct")
        return
    proxies = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "://" in line:
                proxies.append(line)
            elif "@" in line:
                left, right = line.split("@", 1)
                # Si la derecha tiene el host (ej. gw.dataimpulse.com:10000), NO voltear
                if "." in right and ":" in right:
                    proxies.append(f"{scheme}://{line}")
                else:
                    proxies.append(f"{scheme}://{right}@{left}")
            else:
                proxies.append(f"{scheme}://{line}")
    _proxy_pool = proxies
    log(f"loaded {len(proxies)} proxies from {path}")


def next_proxy() -> Optional[str]:
    """Round-robin over proxies, temporarily skipping failed health checks."""
    global _proxy_index
    while True:
        with _proxy_lock:
            if not _proxy_pool:
                return None
            now = time.time()
            for _ in range(len(_proxy_pool)):
                proxy = _proxy_pool[_proxy_index % len(_proxy_pool)]
                _proxy_index += 1
                revive_at = _proxy_bad_until.get(proxy, 0.0)
                if revive_at <= now:
                    _proxy_bad_until.pop(proxy, None)
                    return proxy
            wait_seconds = max(0.1, min(_proxy_bad_until.values()) - now)
        time.sleep(wait_seconds)


def _mark_proxy_unhealthy(proxy: str) -> None:
    """Persistently keep a failing proxy out of rotation for its revive interval."""
    if not proxy or _proxy_revive_seconds <= 0:
        return
    revive_at = time.time() + _proxy_revive_seconds
    with _proxy_lock:
        _proxy_bad_until[proxy] = revive_at
    _persist_proxy_health(proxy, revive_at)


def _proxy_fingerprint(proxy: str) -> str:
    """Return a non-reversible identifier so proxy credentials aren't stored."""
    return hashlib.sha256(proxy.encode("utf-8")).hexdigest()


def _proxy_health_lock():
    """Acquire a small cross-process lock for the proxy health state file."""
    lock_path = _proxy_health_lock_file
    deadline = time.monotonic() + 10.0
    while True:
        try:
            return os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_RDWR)
        except FileExistsError:
            try:
                if time.time() - lock_path.stat().st_mtime > 60:
                    lock_path.unlink()
                    continue
            except OSError:
                pass
            if time.monotonic() >= deadline:
                raise TimeoutError("timed out waiting for proxy health file lock")
            time.sleep(0.1)


def _read_proxy_health() -> dict[str, float]:
    """Read persisted unhealthy-proxy expirations, keyed by hashed proxy URL."""
    try:
        with _proxy_health_file.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return {}
    except (OSError, json.JSONDecodeError) as exc:
        log(f"[proxy] unable to read persisted proxy health state: {exc}")
        return {}
    entries = data.get("unhealthy_until", {}) if isinstance(data, dict) else {}
    if not isinstance(entries, dict):
        log("[proxy] persisted proxy health state has an invalid format")
        return {}
    out = {}
    for fingerprint, expiry in entries.items():
        try:
            out[str(fingerprint)] = float(expiry)
        except (TypeError, ValueError):
            continue
    return out


def _persist_proxy_health(proxy: str, revive_at: float) -> None:
    """Atomically persist hashed proxy expirations without exposing credentials."""
    fd = None
    try:
        fd = _proxy_health_lock()
        entries = _read_proxy_health()
        now = time.time()
        entries = {key: expiry for key, expiry in entries.items() if expiry > now}
        entries[_proxy_fingerprint(proxy)] = revive_at
        _proxy_health_file.parent.mkdir(parents=True, exist_ok=True)
        tmp = _proxy_health_file.with_suffix(f".{os.getpid()}.tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump({"unhealthy_until": entries}, f, indent=2)
        os.replace(tmp, _proxy_health_file)
    except (OSError, TimeoutError) as exc:
        log(f"[proxy] unable to persist proxy health state: {exc}")
    finally:
        if fd is not None:
            os.close(fd)
            try:
                _proxy_health_lock_file.unlink()
            except OSError:
                pass


def _restore_proxy_health() -> None:
    """Restore active cooldowns for proxies in the current pool."""
    now = time.time()
    persisted = _read_proxy_health()
    restored = {}
    for proxy in _proxy_pool:
        expiry = persisted.get(_proxy_fingerprint(proxy), 0.0)
        if expiry > now:
            restored[proxy] = expiry
    with _proxy_lock:
        _proxy_bad_until.clear()
        _proxy_bad_until.update(restored)
    if restored:
        log(f"[proxy] restored {len(restored)} temporarily blocked proxy cooldown(s)")


# ══════════════════════════════════════════════════════════════════════
# Account discovery
# ══════════════════════════════════════════════════════════════════════

def _parse_xml_creds(xml_path: str) -> dict:
    """Read deviceAccount + devicePassword from an XML credentials file."""
    try:
        xml_root = ET.parse(xml_path).getroot()
        return {n.get("name", ""): (n.text or "").strip()
                for n in xml_root.findall("string")}
    except Exception:
        return {}


def _parse_last_pack_pulled(value: str) -> float:
    """
    Convert PTCGPB-leannew's 'lastPackPulled' string to a Unix timestamp.

    Format is "YYYYMMDDHHMMSS" in the bot's local time. We treat it as local
    time (naive), which matches how the bot writes it. Returns 0.0 on failure
    or when the string is empty — a 0 timestamp means "never opened" and the
    account is eligible.
    """
    s = str(value or "").strip()
    if not s or not s.isdigit() or len(s) != 14:
        return 0.0
    try:
        return datetime.strptime(s, "%Y%m%d%H%M%S").timestamp()
    except Exception:
        return 0.0


def _last_pull_ts(jdata) -> float:
    """Newest pulls[].timestamp ("YYYY-MM-DD HH:MM:SS", local time) → unix ts.
    Only the last few entries are checked — pulls[] is append-only."""
    pulls = jdata.get("pulls") if isinstance(jdata, dict) else None
    if not isinstance(pulls, list):
        return 0.0
    best = 0.0
    for entry in pulls[-10:]:
        if not isinstance(entry, dict):
            continue
        try:
            ts = datetime.strptime(str(entry.get("timestamp", "")).strip(),
                                   "%Y-%m-%d %H:%M:%S").timestamp()
            best = max(best, ts)
        except (ValueError, TypeError):
            continue
    return best


_PACK_SUFFIX = re.compile(r"_(\d+)P$")


def _bump_pack_count(account: dict, opened: int) -> None:
    """alitas_01_16P.xml/.json -> alitas_01_18P after opening 2 packs.

    Only files that already carry the _<n>P suffix (Done/ accounts from
    export_done.py) are renamed; other tools' XMLs are never touched. Skipped
    while the account still has collector links in the FR ledger, because the
    cleanup sweep finds it by its current path.
    """
    xml_path = account.get("xml_path") or ""
    stem = os.path.splitext(os.path.basename(xml_path))[0]
    m = _PACK_SUFFIX.search(stem)
    if opened <= 0 or not m or not os.path.isfile(xml_path):
        return
    if account.get("account_key") in fr_cleanup.ledger_entries():
        return
    new_stem = f"{stem[:m.start()]}_{int(m.group(1)) + opened}P"
    folder = os.path.dirname(xml_path)
    try:
        os.replace(xml_path, os.path.join(folder, new_stem + ".xml"))
        account["xml_path"] = os.path.join(folder, new_stem + ".xml")
        json_path = account.get("json_path") or ""
        if json_path and os.path.splitext(os.path.basename(json_path))[0] == stem \
                and os.path.isfile(json_path):
            new_json = os.path.join(os.path.dirname(json_path), new_stem + ".json")
            os.replace(json_path, new_json)
            account["json_path"] = new_json
        log(f"[packs] {stem} -> {new_stem}", tag=account.get("nickname", ""))
    except OSError as exc:
        log(f"[packs] could not rename {stem}: {exc}", tag=account.get("nickname", ""))


GP_ELIGIBILITY_V1 = True
_gp_eligibility = ""   # "" = all, "eligible" = God Pack mode, "locked" = Open Packs Only (set from --gp-eligibility)


def _gp_packs_missing(jdata) -> int:
    """Same rule as Monitor Link (SobresFaltanGP): after a pause of 30+ days an account needs 96 packs again
    to be God Pack eligible; a new 30-day pause (also one still going on today) restarts from 0.
    0 = eligible (or no pack history), otherwise how many packs are still missing."""
    import collections, datetime as _dt
    pulls = jdata.get("pulls", []) if isinstance(jdata, dict) else []
    days = collections.Counter()
    for p in pulls if isinstance(pulls, list) else []:
        ts = str(p.get("timestamp", "") if isinstance(p, dict) else "")
        try:
            days[_dt.date.fromisoformat(ts[:10])] += 1
        except Exception:
            continue
    if not days:
        return 0
    gap, packs, prev = False, 0, None
    for d in sorted(days):
        if prev is not None and (d - prev).days >= 30:
            gap, packs = True, 0
        packs += days[d]
        prev = d
    if (_dt.date.today() - prev).days >= 30:
        return 96
    if not gap:
        return 0
    return 0 if packs >= 96 else 96 - packs


def discover_accounts(
    xml_dir: Optional[str],
    json_dir: Optional[str],
    accounts_dir: str,
    cooldown_hours: float,
) -> list[dict]:
    """
    Discover XML+JSON credential pairs and filter by cooldown.

    Resolution:
      - XML files: from xml_dir if set (searched recursively), else accounts_dir.
      - JSON files: matched by (a) same basename as XML, checked in json_dir first,
        then accounts_dir, then next to the XML. (b) if no basename match, by
        {deviceAccount}.json in the same locations.
      - Cooldown source is the JSON's `metadata.lastPackPulled` string
        (YYYYMMDDHHMMSS written by PTCGPB-leannew). An account is eligible
        when (now - lastPackPulled) >= cooldown_hours, or when the field
        is missing/unparseable (treated as never-opened).
    """
    accounts_dir = str(accounts_dir or "")
    xml_dir = str(xml_dir or "").strip() or accounts_dir
    json_dir = str(json_dir or "").strip() or accounts_dir

    if not os.path.isdir(xml_dir):
        log(f"[!] xml dir not found: {xml_dir}")
        return []

    # Always recursive: `**/*.xml` also matches root-level XMLs, so this
    # covers both flat accounts folders (like scripts/god_pack/accounts/)
    # AND nested leannew-style trees (Accounts/Saved/<session>/*.xml).
    # Previously we used a non-recursive glob when xml_dir == accounts_dir,
    # which silently found 0 files whenever the user pointed both flags at
    # the same leannew directory via the GUI.
    xmls = sorted(glob.glob(os.path.join(xml_dir, "**", "*.xml"), recursive=True))

    log(f"xml scan: {len(xmls)} files under {xml_dir}")

    # Load skip list once — accounts previously classified as likely_banned.
    # Empty set if the file doesn't exist or the feature is disabled.
    skip_list = _load_skip_list(getattr(_qopts, "skip_list_path", "") or "")
    if skip_list:
        log(f"skip list: {len(skip_list)} account(s) will be excluded "
            f"(from {_qopts.skip_list_path})")

    eligible: list[dict] = []
    skipped_cooldown = 0
    skipped_missing_json = 0
    skipped_missing_creds = 0
    skipped_banned = 0
    skipped_gp_mode = 0
    now = time.time()
    cooldown_seconds = cooldown_hours * 3600.0
    # Bot's own "packs used / 0 power" record (reports/god_pack_state.json),
    # loaded ONCE — the whole cooldown decision is offline.
    power_used = gp_state.power_used_map()

    for xml_path in xmls:
        base_name = os.path.splitext(os.path.basename(xml_path))[0]
        xml_creds = _parse_xml_creds(xml_path)
        device_account = xml_creds.get("deviceAccount", "").strip()
        device_password = xml_creds.get("devicePassword", "").strip()
        if not device_account or not device_password:
            skipped_missing_creds += 1
            continue

        # Skip-list check — no point trying to log into a locked account.
        # Case-insensitive to match the lowercased load.
        if skip_list and device_account.lower() in skip_list:
            skipped_banned += 1
            continue

        # Find matching JSON:
        #   1. json_dir/<basename>.json  2. accounts_dir/<basename>.json
        #   3. next to XML                4. json_dir/<device_account>.json
        #   5. accounts_dir/<device_account>.json
        json_candidates = [
            os.path.join(json_dir, f"{base_name}.json"),
            os.path.join(accounts_dir, f"{base_name}.json"),
            os.path.join(os.path.dirname(xml_path), f"{base_name}.json"),
            os.path.join(json_dir, f"{device_account}.json"),
            os.path.join(accounts_dir, f"{device_account}.json"),
        ]
        json_path = ""
        for candidate in json_candidates:
            if candidate and os.path.isfile(candidate) \
                    and not candidate.endswith(".home_battle_menu.json"):
                json_path = candidate
                break
        # XML-only accounts (no JSON anywhere) are still usable: login only
        # needs the XML, and the cooldown falls back to our own
        # last_power_used record. JSON writes are skipped for an empty path.
        if not json_path:
            skipped_missing_json += 1
            jdata = {}
        else:
            # Load JSON for metadata + cooldown source
            try:
                with open(json_path, "r", encoding="utf-8") as f:
                    jdata = json.load(f)
            except Exception as exc:
                log(f"[!] {os.path.basename(json_path)} JSON parse failed: {exc}")
                continue
            try:
                _fix_pack_labels(json_path, jdata)
            except Exception:
                pass

        # PTCGPB-leannew writes account state under `metadata`.
        meta = jdata.get("metadata", {}) if isinstance(jdata, dict) else {}
        if not isinstance(meta, dict):
            meta = {}

        # OFFLINE cooldown check — no proxy, no login. Uses the NEWEST of:
        #   1. metadata.lastPackPulled   (leannew / our json_writer)
        #   2. last pulls[] timestamp    (catches tools that append pulls
        #                                 but don't update lastPackPulled)
        #   3. our own last_power_used   (packs opened or server said 0 power)
        # Only if ALL are empty is the account treated as never-opened.
        last_pack_pulled_raw = str(meta.get("lastPackPulled", "") or "").strip()
        src_ts = {
            "lastPackPulled": _parse_last_pack_pulled(last_pack_pulled_raw),
            "pulls[]": _last_pull_ts(jdata),
            "bot_record": float(power_used.get(base_name, 0)),
        }
        last_used_src, last_used_ts = max(src_ts.items(), key=lambda kv: kv[1])
        if last_used_ts > 0 and (now - last_used_ts) < cooldown_seconds:
            skipped_cooldown += 1
            if skipped_cooldown <= 5:  # only log first few to avoid spam
                age_hours = (now - last_used_ts) / 3600.0
                log(f"cooldown (offline skip): {base_name} "
                    f"last used {age_hours:.1f}h ago via {last_used_src} "
                    f"(need {cooldown_hours}h)")
            continue

        # 2026-11-07 (Ale): the host's own accounts follow the panel's Run Mode like the lent ones:
        # God Pack -> only GP-eligible accounts; Open Packs Only -> only the locked ones (still missing packs).
        if _gp_eligibility:
            locked = _gp_packs_missing(jdata) > 0
            if locked != (_gp_eligibility == "locked"):
                skipped_gp_mode += 1
                continue

        # Nickname — prefer metadata.nickname (leannew schema), fall back to
        # root-level `nickname` (older schema), then to the base filename.
        nickname = (
            str(meta.get("nickname", "") or "").strip()
            or str(jdata.get("nickname", "") or "").strip()
            or base_name
        )

        eligible.append({
            "json_path": json_path,
            "xml_path": xml_path,
            # "_16P" pack counter suffix is not part of the identity: the
            # cooldown record must survive the file being renamed to _18P.
            "account_key": _PACK_SUFFIX.sub("", base_name),
            "account_id": device_account,
            "password": device_password,
            "nickname": nickname,
            "last_pack_pulled": last_pack_pulled_raw,
            "last_used_ts": last_used_ts,          # 0 = never used anywhere
            "device_identifier": jdata.get("device_identifier", ""),
            "authorize_device_account": jdata.get("authorize_device_account", ""),
        })

    if _gp_eligibility:
        log(f"run mode filter: {skipped_gp_mode} account(s) skipped - this run opens only "
            + ("GP-eligible accounts (96 packs since the last 30-day pause)" if _gp_eligibility == "eligible"
               else "accounts NOT yet GP-eligible (still missing packs to 96)"))
    total_scanned = (len(eligible) + skipped_cooldown
                     + skipped_missing_creds + skipped_banned + skipped_gp_mode)
    log(f"discovered: eligible={len(eligible)} "
        f"skipped offline (cooldown)={skipped_cooldown} "
        f"xml_only(no json, still used)={skipped_missing_json} "
        f"missing_creds={skipped_missing_creds} "
        f"banned_skipped={skipped_banned} "
        f"(total_scanned={total_scanned})")
    # Stash the scan-total for run_injection() → record_run_summary() so
    # the pool report can show 24h coverage against the full pool size.
    global _last_discovery_total
    _last_discovery_total = total_scanned
    return eligible


# Populated by discover_accounts() on each call; consumed by run_injection().
_last_discovery_total: int = 0


# ══════════════════════════════════════════════════════════════════════
# Skip list + quarantine
# Accounts classified as likely_banned (see errors.classify_login_failure)
# get their device_account appended to the skip list. discover_accounts()
# consults this list at startup and filters those out before applying
# cooldown, so a locked account never wastes another login attempt.
# ══════════════════════════════════════════════════════════════════════
class _QuarantineOpts:
    """Module-level knobs set by run_injection() before workers spawn."""
    enabled: bool = False
    skip_list_path: str = ""

_qopts = _QuarantineOpts()


def _default_skip_list_path() -> str:
    return str(PROJECT_ROOT / "reports" / "skip_accounts.txt")


# ══════════════════════════════════════════════════════════════════════
# Pack-name lookup for the pool report
# ══════════════════════════════════════════════════════════════════════
def _lookup_pack_display_name(pack_id: str) -> str:
    """
    Return "<name>" for a given pack_id, or the raw pack_id if unknown.

    Consults scripts.god_pack.pack_catalog first (same source the GUI uses),
    falls back to a tiny built-in mapping so this file still works if the
    catalog module is missing.
    """
    if not pack_id:
        return "(unspecified)"
    try:
        from scripts.god_pack.pack_catalog import paid_pack_options
        for entry in paid_pack_options():
            if entry.get("pack_id") == pack_id:
                nm = entry.get("name", "").strip()
                if nm:
                    return nm
    except Exception:
        pass
    # Fallback for offline / missing catalog — keep in sync with god_pack_gui
    # PACK_OPTIONS. Not exhaustive; unknown IDs just print raw.
    _FALLBACK = {
        "BN010_0010_00_000": "Team Rocket's Ambition",
        "BN001_0030_00_000": "Mega Altaria",
        "BN001_0010_00_000": "Charizard",
        "BN001_0020_00_000": "Mewtwo",
        "BN001_0040_00_000": "Pikachu",
        "BN002_0010_00_000": "Mew",
        "BN003_0010_00_000": "Dialga",
        "BN003_0020_00_000": "Palkia",
        "BN004_0010_00_000": "Arceus",
        "BN005_0010_00_000": "Shining",
        "BN006_0010_00_000": "Solgaleo",
        "BN006_0020_00_000": "Lunala",
        "BN007_0010_00_000": "Buzzwole",
        "BN008_0010_00_000": "Eevee",
        "BN009_0010_00_000": "Extradimensional",
    }
    return _FALLBACK.get(pack_id, pack_id)


def _annotate_pool_report_with_pack(pack_id: str) -> None:
    """
    Insert a "Last run pack:" line into the pool report just below the
    Generated: line, so the reader knows which pack the numbers below are
    for. Idempotent: if the line already exists, it's replaced with the
    current run's value (not duplicated).

    Best-effort — a failure to patch is silently ignored; the report still
    shows the stats, just without the pack annotation.
    """
    try:
        report_path = gp_state.report_md_path()
    except Exception:
        return
    if not report_path:
        return
    p = Path(report_path)
    if not p.is_file():
        return

    display_name = _lookup_pack_display_name(pack_id)
    new_line = f"Last run pack: **{display_name}** (`{pack_id or 'unspecified'}`)"

    try:
        text = p.read_text(encoding="utf-8")
    except Exception:
        return

    lines = text.splitlines()
    # Remove any previous annotation so re-runs replace instead of stacking.
    lines = [ln for ln in lines if not ln.startswith("Last run pack:")]

    # Insert immediately after the "Generated:" line if present, else at
    # the top under the H1.
    inserted = False
    for i, ln in enumerate(lines):
        if ln.startswith("Generated:"):
            lines.insert(i + 1, new_line)
            inserted = True
            break
    if not inserted:
        # Fall back: put it after the first H1 header.
        for i, ln in enumerate(lines):
            if ln.startswith("# "):
                lines.insert(i + 1, "")
                lines.insert(i + 2, new_line)
                inserted = True
                break
    if not inserted:
        lines.insert(0, new_line)

    try:
        p.write_text("\n".join(lines) + ("\n" if not text.endswith("\n") else ""),
                     encoding="utf-8")
    except Exception:
        pass


def _load_skip_list(path: str) -> set:
    """Load device_account IDs from the skip list. Missing file → empty set."""
    if not path:
        return set()
    try:
        with open(path, "r", encoding="utf-8") as f:
            return {
                line.strip().lower()
                for line in f
                if line.strip() and not line.strip().startswith("#")
            }
    except FileNotFoundError:
        return set()
    except OSError as exc:
        log(f"[!] could not read skip list {path}: {exc}")
        return set()


def _append_to_skip_list(path: str, device_account: str, reason: str) -> bool:
    """Append a device_account to the skip list with a comment. Best-effort."""
    if not path or not device_account:
        return False
    try:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a", encoding="utf-8") as f:
            ts = time.strftime("%Y-%m-%d %H:%M:%S")
            f.write(f"{device_account}  # {ts} {reason}\n")
        return True
    except OSError as exc:
        log(f"[!] could not append to skip list {path}: {exc}")
        return False


def _quarantine_account(
    account: dict,
    classification: str,
    reason_text: str,
    skip_list_path: str,
    tag: str = "",
) -> None:
    """
    Move an account's XML + all companion JSONs to accounts/QUARANTINE/{classification}/
    and drop a .reason.txt file next to them. For 'likely_banned', also
    append the device_account to the skip list so future runs skip it.

    Best-effort — any error is logged but never raised (a quarantine
    failure should not stop the batch).
    """
    if classification == "transient":
        return  # nothing to move, retry next run

    xml_path = account.get("xml_path") or ""
    json_path = account.get("json_path") or ""
    device_account = (account.get("account_id") or "").lower()

    # Find source dir + basename from whichever path we have.
    source_dir = None
    basename = ""
    for candidate in (xml_path, json_path):
        if candidate:
            p = Path(candidate)
            if not source_dir:
                source_dir = p.parent
            if not basename:
                basename = p.stem
    if not source_dir or not basename:
        log(f"[quarantine] {tag}: no path info, cannot move files", tag=tag)
    else:
        try:
            # (Arcade 2026-11-06) One QUARANTINE folder for every account (the reason, with its
            # classification, is in <name>.reason.txt) instead of one subfolder per classification.
            dest_root = source_dir / "QUARANTINE"
            dest_root.mkdir(parents=True, exist_ok=True)
            # Glob everything in the source dir starting with basename —
            # catches xml, json, .home_battle_menu.json, .state.json, etc.
            candidates = [
                fp for fp in source_dir.iterdir()
                if fp.is_file() and fp.name.startswith(basename)
            ]
            moved = 0
            for fp in candidates:
                dest = dest_root / fp.name
                try:
                    if dest.exists():
                        dest.unlink()
                    shutil.move(str(fp), str(dest))
                    moved += 1
                except Exception as exc:
                    log(f"[quarantine] move failed for {fp.name}: {exc}", tag=tag)
            # (Arcade) The account JSON lives in another folder (Cards/accounts, named by deviceAccount):
            # move it too, next to its XML, so the quarantined account is complete in one place.
            if json_path:
                jp = Path(json_path)
                try:
                    if jp.is_file() and jp.parent != source_dir:
                        dest = dest_root / jp.name   # original name: it can go back to Cards/accounts as is
                        if dest.exists():
                            dest.unlink()
                        shutil.move(str(jp), str(dest))
                        moved += 1
                except Exception as exc:
                    log(f"[quarantine] move failed for {jp.name}: {exc}", tag=tag)
            # Write a companion .reason.txt so the user can see WHY without
            # digging through logs.
            try:
                reason_path = dest_root / f"{basename}.reason.txt"
                reason_path.write_text(reason_text, encoding="utf-8")
            except Exception as exc:
                log(f"[quarantine] reason file write failed: {exc}", tag=tag)
            log(f"[quarantine] moved {moved} file(s) to {dest_root}", tag=tag)
        except Exception as exc:
            log(f"[quarantine] unexpected error: {exc}", tag=tag)

    # Skip-list: only for likely_banned. Unknown_failure accounts stay
    # eligible so the user can review, move them back if wrong, or move
    # them to DONE/BANNED manually if confirmed.
    if classification == "likely_banned" and device_account:
        if _append_to_skip_list(skip_list_path, device_account,
                                 reason="login PERMISSION_DENIED after >=2 proxies"):
            log(f"[quarantine] {device_account} added to skip list", tag=tag)


# ══════════════════════════════════════════════════════════════════════
# Session helpers
# ══════════════════════════════════════════════════════════════════════

def login_account(account: dict, max_retries: int = 2) -> Optional[object]:
    """
    Login to an account. Rotates proxy on failure. Returns GameSession or None.

    On failure, stashes structured info into account["_login_failure"] so
    the caller (inject_one) can classify — banned vs proxy vs unknown —
    and quarantine appropriately. Fields:
      - "last_error_obj": the last exception or None
      - "last_error_str": stringified error for the .reason.txt file
      - "proxies_tried": set of unique proxy URLs we tried
      - "attempts": total attempts made
    """
    from engine.core.session import GameSession
    last_err = None
    last_err_obj = None
    proxies_tried: set = set()
    attempts_done = 0
    for attempt in range(1, max_retries + 1):
        attempts_done = attempt
        proxy = next_proxy()
        # SAFETY (Fix 2, 2026-09-28): refuse to attempt a login without a
        # proxy. The Go tunnel used to silently dial the game host over
        # the machine's public IP when proxy_url was empty/malformed,
        # which is how the main IP got banned. Even after the Go binary's
        # SAFETY guard (Fix 1) rejects direct dials, we don't want to
        # burn a login attempt (and log a scary error) — fail fast here.
        if not proxy or not isinstance(proxy, str) or "@" not in proxy:
            tag = account["nickname"]
            log(f"[X] login refused: next_proxy() returned no usable "
                f"value ({proxy!r}). Check proxies.txt is populated and "
                f"has 'user:pass@host:port' lines. NOT dialing direct.",
                tag=tag)
            last_err = "no_proxy_available"
            last_err_obj = None
            break
        proxies_tried.add(proxy)
        proxy_display = proxy.split("@")[-1][:25]
        tag = account["nickname"]
        log(f"login attempt {attempt}/{max_retries} proxy={proxy_display}", tag=tag)
        try:
            sess = GameSession(
                account_id=account["account_id"],
                password=account["password"],
                proxy_url=proxy,
                log_fn=lambda m, t=tag: log(str(m)[:200], tag=t),
            )
            # Restore stable identifiers if present
            if account.get("device_identifier"):
                sess._device_identifier = account["device_identifier"]
            if account.get("authorize_device_account"):
                sess._authorize_device_account = account["authorize_device_account"]

            result = sess.login()
            if result.get("success"):
                healthy = True
                en_uso = False
                for check_index in range(_proxy_checks):
                    power = get_pack_power(sess, max_retries=1, tag=tag)
                    if power == -2:   # account open elsewhere: the proxy is fine, skip the account
                        en_uso = True
                        break
                    if power < 0:
                        healthy = False
                        log(f"[proxy] post-login health check "
                            f"{check_index + 1}/{_proxy_checks} failed",
                            tag=tag)
                        if check_index + 1 < _proxy_checks and _proxy_check_gap > 0:
                            time.sleep(_proxy_check_gap)
                    else:
                        healthy = True
                        log(f"[proxy] post-login health check "
                            f"{check_index + 1}/{_proxy_checks} passed",
                            tag=tag)
                        break
                if en_uso:
                    try:
                        sess.close()
                    except Exception:
                        pass
                    last_err = "account_in_use (ABORTED: open somewhere else)"
                    last_err_obj = last_err
                    log("[info] skipping this account for now - it is open somewhere else "
                        "(its owner, another bot or another host). It is retried next run.", tag=tag)
                    break
                if not healthy:
                    _mark_proxy_unhealthy(proxy)
                    log(f"[proxy] marking current proxy unhealthy for "
                        f"{_proxy_revive_seconds}s; trying another proxy",
                        tag=tag)
                    try:
                        sess.close()
                    except Exception:
                        pass
                    last_err = "proxy_health_check_failed"
                    last_err_obj = last_err
                    continue
                log(f"login OK player_id={sess.player_id}", tag=tag)
                # Clear any previous failure snapshot on success.
                account.pop("_login_failure", None)
                _clear_in_use(account.get("account_key", ""))
                return sess
            last_err = result.get("error", "unknown")
            last_err_obj = result.get("error_obj") or last_err
            log(f"login failed: {str(last_err)[:200]}", tag=tag)
        except Exception as exc:
            last_err = str(exc)
            last_err_obj = exc
            log(f"login exception: {str(exc)[:200]}", tag=tag)
        time.sleep(3)
    if not str(last_err).startswith("account_in_use"):
        log(f"[X] login exhausted after {max_retries} attempts (last: {str(last_err)[:120]})",
            tag=account["nickname"])
    # Expose failure metadata for the quarantine classifier upstream.
    account["_login_failure"] = {
        "last_error_obj": last_err_obj,
        "last_error_str": str(last_err) if last_err is not None else "",
        "proxies_tried": list(proxies_tried),
        "attempts": attempts_done,
    }
    return None


# Process-wide cache: 16-digit friend code (or UUID) → resolved player_id UUID.
# A friend code always resolves to the same UUID, so we only need one successful
# Friend/SearchV1 call per code across the whole run.
_pid_cache: dict = {}
_pid_cache_lock = threading.Lock()


def _cache_get(key: str) -> Optional[str]:
    with _pid_cache_lock:
        return _pid_cache.get(key)


def _cache_set(key: str, value: str) -> None:
    with _pid_cache_lock:
        _pid_cache[key] = value


_live_url_cache: dict = {}
_live_url_lock = threading.Lock()


def expand_live_collector_codes(codes_or_urls: list[str], ttl_sec: float = 15.0) -> list[str]:
    """
    Si algún elemento en collector_codes es una URL (ej. https://onlineids.zenithrise.workers.dev/elite),
    consulta la lista en vivo y extrae todos los Friend IDs de 16 dígitos o UUIDs activos.
    """
    import urllib.request
    resolved: list[str] = []
    uuid_pattern = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', re.I)
    id16_pattern = re.compile(r'\b(?:\d{4}-\d{4}-\d{4}-\d{4}|\d{16})\b')

    for item in codes_or_urls:
        s = str(item or "").strip()
        if not s:
            continue
        if s.startswith("http://") or s.startswith("https://"):
            now = time.time()
            text = ""
            with _live_url_lock:
                cached_ts, cached_text = _live_url_cache.get(s, (0.0, ""))
                if now - cached_ts < ttl_sec and cached_text:
                    text = cached_text
            if not text:
                try:
                    req = urllib.request.Request(s, headers={"User-Agent": "Mozilla/5.0"})
                    with urllib.request.urlopen(req, timeout=5) as resp:
                        text = resp.read().decode("utf-8", errors="ignore")
                    with _live_url_lock:
                        _live_url_cache[s] = (now, text)
                except Exception as exc:
                    log(f"[!] Error leyendo lista online {s}: {exc}")
                    text = cached_text  # Usa la última lista conocida si falla el internet un segundo

            # Extraer todos los IDs de 16 dígitos (con o sin guiones) y UUIDs de la respuesta
            found_16 = [m.replace("-", "") for m in id16_pattern.findall(text)]
            found_uuid = uuid_pattern.findall(text)
            for c in (found_16 + found_uuid):
                if c not in resolved:
                    resolved.append(c)
        else:
            if s not in resolved:
                resolved.append(s)

    return resolved

#Lista de ids
# URLs de tus listas dinámicas en Cloudflare Workers
LIVE_WORKER_URLS = [
    "https://onlineids.zenithrise.workers.dev/trainer",
]

_live_url_cache: dict = {}
_live_url_lock = threading.Lock()

def fetch_live_worker_codes(fallback_codes: list[str], ttl_sec: float = 15.0) -> list[str]:
    import urllib.request
    resolved: list[str] = []
    id16_pattern = re.compile(r'\b(?:\d{4}-\d{4}-\d{4}-\d{4}|\d{16})\b')
    uuid_pattern = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', re.I)

    # Capturar la URL de forma directa desde sys.argv (el comando exacto que lanza el GUI)
    worker_url = "https://onlineids.zenithrise.workers.dev/trainer" # Respaldo por defecto
    try:
        for i, arg in enumerate(sys.argv):
            if arg == "--worker-url" and i + 1 < len(sys.argv):
                val = sys.argv[i + 1].strip()
                if val:
                    worker_url = val
                break
    except Exception:
        pass

    urls_to_fetch = [worker_url] if worker_url else []

    for u in urls_to_fetch:
        now = time.time()
        text = ""
        with _live_url_lock:
            cached_ts, cached_text = _live_url_cache.get(u, (0.0, ""))
            if now - cached_ts < ttl_sec and cached_text:
                text = cached_text
        if not text:
            try:
                req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=5) as resp:
                    text = resp.read().decode("utf-8", errors="ignore")
                with _live_url_lock:
                    _live_url_cache[u] = (now, text)
            except Exception as exc:
                log(f"[!] Error leyendo Worker {u}: {exc}")
                text = cached_text

        # Diagnóstico en consola para ver qué devolvió exactamente el link
        log(f"[worker-debug] Contenido recibido de {u}: {text[:150]}...")

        try:
            data = json.loads(text)
            if isinstance(data, list):
                for elem in data:
                    se = str(elem).strip().replace("-", "")
                    if len(se) == 16 and se.isdigit() and se not in resolved:
                        resolved.append(se)
            elif isinstance(data, dict):
                def _ext(d):
                    if isinstance(d, dict):
                        for k, v in d.items(): _ext(v)
                    elif isinstance(d, list):
                        for elem in d: _ext(elem)
                    elif isinstance(d, (str, int)):
                        sv = str(d).strip().replace("-", "")
                        if len(sv) == 16 and sv.isdigit() and sv not in resolved:
                            resolved.append(sv)
                _ext(data)
        except Exception:
            pass

        found_16 = [m.replace("-", "") for m in id16_pattern.findall(text)]
        found_uuid = uuid_pattern.findall(text)
        for c in (found_16 + found_uuid):
            if c not in resolved:
                resolved.append(c)

    # Agregar también los IDs manuales de la lista del GUI
    for item in fallback_codes:
        s = str(item or "").strip()
        if not s:
            continue
        clean_id = s.replace("-", "")
        if len(clean_id) == 16 and clean_id.isdigit() and clean_id not in resolved:
            resolved.append(clean_id)

    log(f"[worker-elite] Total IDs listos para enviar solicitud: {len(resolved)} IDs")
    return resolved

# Tope de collectors por cuenta (2026-11-01, pedido de Ale): con 15 online cada cuenta mandaba 15
# solicitudes y despues borraba las 15 amistades una por una, y el PPM caia a un tercio. Ahora cada
# cuenta manda a los codigos propios del panel + hasta _max_collectors de la lista online, rotando
# entre cuentas para que todos los online sigan recibiendo God Packs.
_max_collectors = 0   # 0 = all online collectors (Ale: everyone online must be able to pick the GP)
_collector_turn = itertools.count()


FR_MAX_PER_MIN = 20.0            # friend requests per minute to any one collector (Main), ceiling
COLLECTOR_PAUSE_SEC = 15 * 60    # a Main refusing requests again and again is skipped 15 min
COLLECTOR_FAILS_TO_PAUSE = 3     # ...after this many refusals within COLLECTOR_PAUSE_SEC (full list / soft-ban)
_paused_lock = threading.Lock()
_paused_cache = {"ts": 0.0, "data": {}}


PAUSE_COLLECTORS = True    # 2026-11-07 (wr98: ~1000 "server busy" alerts with it OFF): back ON, 15 min. A Main
                           # refuses when its friend list is full (99) or it has too many pending requests;
                           # without the pause EVERY account hit it again (and logged an error).


def _paused_collectors() -> dict:
    """reports/collectors_paused_v2.json {code: until_epoch}, shared by every inject.py on this PC."""
    if not PAUSE_COLLECTORS:
        return {}
    now = time.time()
    if now - _paused_cache["ts"] < 30:
        return _paused_cache["data"]
    data = {}
    try:
        raw = json.loads((PROJECT_ROOT / "reports" / "collectors_paused_v2.json").read_text("utf-8")) or {}
        raw = raw.get("paused", {}) if "paused" in raw else {}   # old format: ignored (it was too eager)
        data = {str(k): float(v) for k, v in raw.items() if float(v) > now}
    except Exception:
        pass
    _paused_cache.update(ts=now, data=data)
    return data


def _pause_collectors(codes: list[str], tag: str = "") -> None:
    """2026-11-06 (Ale): a Main that refuses our request while other Mains accept it (full friend list or
    friend soft-ban) gets a strike; 3 strikes within 30 min = skipped for 30 min. Shared by every inject.py
    on this PC (reports/collectors_paused_v2.json: {"paused": {code: until}, "fails": {code: [ts, ...]}})."""
    codes = [str(c or "").replace("-", "").strip() for c in codes if c]
    if not codes or not PAUSE_COLLECTORS:
        return
    path = PROJECT_ROOT / "reports" / "collectors_paused_v2.json"   # v2: old file had false pauses
    now = time.time()
    nuevos = []
    with _paused_lock:
        try:
            data = json.loads(path.read_text("utf-8")) if path.exists() else {}
        except Exception:
            data = {}
        if "paused" not in data:   # old format {code: until}
            data = {"paused": {}, "fails": {}}
        paused = {k: float(v) for k, v in data.get("paused", {}).items() if float(v) > now}
        fails = {k: [t for t in v if now - float(t) < COLLECTOR_PAUSE_SEC] for k, v in data.get("fails", {}).items()}
        for c in codes:
            fails.setdefault(c, []).append(now)
            if len(fails[c]) >= COLLECTOR_FAILS_TO_PAUSE and c not in paused:
                paused[c] = now + COLLECTOR_PAUSE_SEC
                fails[c] = []
                nuevos.append(c)
        fails = {k: v for k, v in fails.items() if v}
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({"paused": paused, "fails": fails}), encoding="utf-8")
        except Exception:
            pass
        _paused_cache["ts"] = 0.0
    if nuevos:
        log(f"[fr] {len(nuevos)} Main(s) refused requests {COLLECTOR_FAILS_TO_PAUSE} times in "
            f"{COLLECTOR_PAUSE_SEC // 60} min (friend list full?) - skipped for {COLLECTOR_PAUSE_SEC // 60} min: "
            f"{', '.join(nuevos)}", tag=tag)


def _limit_collectors(live_codes: list[str], manual_codes: list[str]) -> list[str]:
    # Paused Mains (refusing requests) are skipped; if EVERY one is paused, keep them so the run still works.
    paused = _paused_collectors()
    sin_pausa = [c for c in live_codes if str(c).replace("-", "").strip() not in paused]
    if sin_pausa:
        live_codes = sin_pausa
    if _max_collectors <= 0:
        return live_codes
    manual = {str(c or "").replace("-", "").strip() for c in manual_codes}
    online = [c for c in live_codes if c not in manual]
    if len(online) <= _max_collectors:
        return live_codes
    start = (next(_collector_turn) * _max_collectors) % len(online)
    pick = [online[(start + i) % len(online)] for i in range(_max_collectors)]
    return pick + [c for c in live_codes if c in manual]


_full_lock = threading.Lock()


_FULL_POWER_ONLY = False   # set from --full-power-only in main()
_banned_lock = threading.Lock()


IN_USE_STRIKES_V1 = True
IN_USE_STRIKE_GAP_SEC = 60 * 60          # strikes count once per hour (one per run, not per retry)
IN_USE_LOCKED_AFTER_SEC = 6 * 60 * 60    # ...and the first one must be 6+ hours old
_in_use_lock = threading.Lock()


def _in_use_strike(account_key: str, tag: str = "") -> bool:
    """Record one 'open somewhere else' answer for this account (reports/in_use_strikes.json, shared by every
    inject.py on this PC). True when it now has 3 strikes, an hour apart, the oldest 6+ hours ago = locked."""
    if not account_key:
        return False
    path = PROJECT_ROOT / "reports" / "in_use_strikes.json"
    now = time.time()
    with _in_use_lock:
        try:
            data = json.loads(path.read_text("utf-8")) if path.exists() else {}
        except Exception:
            data = {}
        data = {k: [t for t in v if now - float(t) < 3 * 24 * 3600] for k, v in data.items()}
        strikes = data.setdefault(account_key, [])
        if not strikes or now - float(strikes[-1]) >= IN_USE_STRIKE_GAP_SEC:
            strikes.append(now)
        locked = len(strikes) >= 3 and now - float(strikes[0]) >= IN_USE_LOCKED_AFTER_SEC
        if locked:
            data.pop(account_key, None)
        data = {k: v for k, v in data.items() if v}
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data), encoding="utf-8")
        except Exception:
            pass
    return locked


def _clear_in_use(account_key: str) -> None:
    """The account logged in and answered normally: forget its 'open somewhere else' strikes."""
    path = PROJECT_ROOT / "reports" / "in_use_strikes.json"
    if not account_key or not path.exists():
        return
    with _in_use_lock:
        try:
            data = json.loads(path.read_text("utf-8")) or {}
            if account_key in data:
                data.pop(account_key)
                path.write_text(json.dumps(data), encoding="utf-8")
        except Exception:
            pass


def _note_banned(account: dict, err_str: str, proxies_tried: int, tag: str = "") -> None:
    """Likely banned (the game refused the account with real auth details on 2+ proxies): one line in
    reports/banned_accounts.jsonl. The Monitor Pokemon bot reads it (GP farm) and warns the owner."""
    try:
        xml = Path(account.get("xml_path") or account.get("json_path") or "").name
        path = PROJECT_ROOT / "reports" / "banned_accounts.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with _banned_lock, open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps({"ts": int(time.time() * 1000), "xml": xml, "account": tag,
                                "proxies": proxies_tried, "error": (err_str or "")[:300]}) + "\n")
        log(f"[!] LIKELY BANNED: the game refused this account on {proxies_tried} proxies", tag=tag)
    except Exception as exc:
        log(f"[!] could not write banned_accounts.jsonl: {str(exc)[:120]}", tag=tag)


def _skip_partial_power(power: int, packs: int, hg_cost, result: dict, tag: str = "") -> bool:
    """--full-power-only: skip a free-pack account whose server power is known (>= 0) but lower
    than the packs we want (e.g. 1 of 2). Nothing is stamped: it is picked again once recharged."""
    if not _FULL_POWER_ONLY or power < 0 or (hg_cost or 0) > 0 or power >= int(packs or 0):
        return False
    result["error"] = f"verify_power_partial (server says {power} of {packs} packs)"
    log(f"skipping - only {power} of {packs} packs recharged (full-power-only). Not sending FR.", tag=tag)
    return True


def _note_full_collectors(pids: list[str], pid_to_code: dict, tag: str = "") -> None:
    """Anota collectors que rechazaron la solicitud mientras otros la aceptaban (lista llena).
    El bot de Monitor Pokemon lee reports/collectors_full.jsonl y avisa (anti doble reroll)."""
    try:
        path = PROJECT_ROOT / "reports" / "collectors_full.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with _full_lock, open(path, "a", encoding="utf-8") as f:
            for pid in pids:
                f.write(json.dumps({"ts": int(time.time() * 1000), "pid": pid,
                                    "code": pid_to_code.get(pid, ""), "account": tag}) + "\n")
    except Exception as exc:
        log(f"[fr] could not write collectors_full.jsonl: {str(exc)[:120]}", tag=tag)


def resolve_friend_code(sess, friend_code: str, max_retries: int = 3) -> Optional[str]:
    """
    Convert 16-digit friend code (dashed or raw) or UUID to player_id UUID.

    Uses a process-wide cache — after the first successful lookup, every other
    account reuses that UUID without another SearchV1 call. Retries transient
    RPC errors (502/DEADLINE_EXCEEDED) up to max_retries.
    """
    raw = (friend_code or "").strip()
    uuid_re = re.compile(
        r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        re.IGNORECASE,
    )
    if uuid_re.match(raw):
        return raw
    digits = "".join(c for c in raw if c.isdigit())
    if len(digits) != 16:
        log(f"[X] invalid friend code {raw!r}: expected 16 digits or UUID")
        return None

    cached = _cache_get(digits)
    if cached:
        return cached

    from engine.takasho.schema.lettuce_server.player_api import friend_search_v1_pb2
    from google.protobuf.json_format import MessageToDict

    last_err = ""
    for attempt in range(1, max_retries + 1):
        try:
            req = friend_search_v1_pb2.FriendSearchV1.Types.Request(
                search_friend_id=digits,
            )
            resp = sess._call(
                "/takasho.schema.lettuce_server.player_api.Friend/SearchV1",
                req,
                friend_search_v1_pb2.FriendSearchV1.Types.Response,
            )
            raw_dict = MessageToDict(resp, preserving_proto_field_name=True)
            results = raw_dict.get("results", [])
            if not results:
                log(f"[X] friend code {digits} not found")
                return None
            pid = results[0].get("player_id", "")
            if pid:
                _cache_set(digits, pid)
                log(f"[+] cached friend code {digits} -> {pid}")
                return pid
            return None
        except Exception as exc:
            last_err = str(exc)[:200]
            # Only retry on transient network errors
            transient = ("UNAVAILABLE" in last_err or "DEADLINE_EXCEEDED" in last_err
                         or "502" in last_err or "503" in last_err
                         or "504" in last_err or "reset" in last_err.lower())
            if attempt < max_retries and transient:
                delay = 0.6 * attempt  # 0.6s, 1.2s
                log(f"[.] Friend/SearchV1 attempt {attempt}/{max_retries} "
                    f"transient error, retrying in {delay:.1f}s: {last_err[:120]}")
                time.sleep(delay)
                continue
            break
    log(f"[X] Friend/SearchV1 failed after {attempt} attempt(s): {last_err[:200]}")
    return None


# Cache the discovered SendRequestsV1 field name across calls (per process).
_send_requests_field_cache: dict = {"name": None, "repeated": None, "logged": False}


def _dump_message_schema(Request, label: str) -> None:
    """One-time full field dump for a Request/Response proto so we can see
    exactly what the compiled pb2 contains."""
    try:
        fields = Request.DESCRIPTOR.fields_by_name
    except Exception as exc:
        log(f"[?] {label}: cannot introspect DESCRIPTOR: {exc}")
        return
    # protobuf FieldDescriptor.TYPE_* codes
    TYPE_NAMES = {
        1: "DOUBLE", 2: "FLOAT", 3: "INT64", 4: "UINT64", 5: "INT32",
        6: "FIXED64", 7: "FIXED32", 8: "BOOL", 9: "STRING", 10: "GROUP",
        11: "MESSAGE", 12: "BYTES", 13: "UINT32", 14: "ENUM",
        15: "SFIXED32", 16: "SFIXED64", 17: "SINT32", 18: "SINT64",
    }
    LABEL_NAMES = {1: "optional", 2: "required", 3: "repeated"}
    log(f"[SCHEMA] {label} has {len(fields)} field(s):")
    for name, f in fields.items():
        try:
            t = TYPE_NAMES.get(getattr(f, "type", 0), f"type#{getattr(f,'type',0)}")
            l = LABEL_NAMES.get(getattr(f, "label", 0), f"label#{getattr(f,'label',0)}")
            num = getattr(f, "number", "?")
            msg = ""
            if getattr(f, "type", 0) == 11 and f.message_type is not None:
                msg = f" ({f.message_type.full_name})"
            log(f"[SCHEMA]   #{num} {l} {t} {name}{msg}")
        except Exception:
            pass


def _discover_send_requests_field(Request) -> tuple[Optional[str], Optional[bool]]:
    """
    Figure out the actual target-ids field name on FriendSendRequestsV1.Request.
    Returns (field_name, is_repeated). Falls back to any repeated/singular field
    whose name looks like a player id list.
    """
    if _send_requests_field_cache["name"] is not None:
        return _send_requests_field_cache["name"], _send_requests_field_cache["repeated"]

    try:
        fields = Request.DESCRIPTOR.fields_by_name
    except Exception:
        return None, None

    LABEL_REPEATED = 3  # protobuf FieldDescriptor.LABEL_REPEATED

    # Preferred names to try, plural (repeated) first then singular.
    plural_candidates = [
        "player_ids", "send_player_ids", "target_player_ids",
        "receive_player_ids", "request_player_ids", "friend_player_ids",
        "to_player_ids",
    ]
    singular_candidates = [
        "player_id", "send_player_id", "target_player_id",
        "receive_player_id", "request_player_id", "friend_player_id",
        "to_player_id",
    ]

    for name in plural_candidates:
        f = fields.get(name)
        if f is not None and getattr(f, "label", 0) == LABEL_REPEATED:
            _send_requests_field_cache.update({"name": name, "repeated": True})
            return name, True
    for name in singular_candidates:
        if name in fields:
            _send_requests_field_cache.update({"name": name, "repeated": False})
            return name, False

    # Last resort: any repeated string field looking id-ish
    for name, f in fields.items():
        try:
            if getattr(f, "label", 0) == LABEL_REPEATED and "player" in name.lower():
                _send_requests_field_cache.update({"name": name, "repeated": True})
                return name, True
        except Exception:
            pass
    for name, f in fields.items():
        try:
            if "player" in name.lower():
                _send_requests_field_cache.update({"name": name, "repeated": False})
                return name, False
        except Exception:
            pass

    return None, None


_fr_state = threading.local()   # proxy_blocked: the last send failed because the proxy returned a web page


def send_friend_requests(sess, target_pids: list[str], tag: str = "") -> bool:
    """
    Send friend request to one or more player_ids using batched helper.
    """
    if not target_pids:
        return True

    _fr_state.proxy_blocked = False
    # 2026-11-07 (Arcade: 15 of 19 Mains paused): Mains of the batches that DID go through before a batch
    # failed. The caller retries Main by Main only the others; re-sending to these got "already sent",
    # which was counted as a refusal and paused healthy Mains.
    _fr_state.sent_ok = []
    helper = getattr(sess, "send_friend_requests", None)
    if callable(helper):
        import time
        batch_size = 2
        for i in range(0, len(target_pids), batch_size):
            batch = target_pids[i:i + batch_size]
            if i:
                _fr_state.sent_ok.extend(target_pids[i - batch_size:i])
            try:
                r = helper(list(batch))
                if isinstance(r, dict) and not r.get("success", True):
                    err_str = str(r.get("error", ""))
                    if "ABORTED" in err_str:
                        log(f"[info] friend request refused by a Main (full friend list or too many pending "
                            f"requests) - retrying Main by Main", tag=tag)
                        return False
                    # 2026-11-06 (Arcade): a web page instead of a game answer = the proxy/firewall blocks
                    # friend requests from this IP. Every next batch fails the same way: stop here (one line,
                    # not one per batch) and the caller doesn't retry one by one from this proxy.
                    if "<!doctype" in err_str.lower() or "<html" in err_str.lower():
                        _fr_state.proxy_blocked = True
                        log(f"[!] SendRequestsV1 blocked by the proxy (web page) - stopping friend requests "
                            f"for this account", tag=tag)
                        return False
                    log(f"[!] SendRequestsV1 helper error: {err_str[:200]}", tag=tag)
            except Exception as exc:
                if "ABORTED" in str(exc):
                    return False
                log(f"[!] sess.send_friend_requests helper crashed: {str(exc)[:200]}", tag=tag)
                return False
            
            if i + batch_size < len(target_pids):
                time.sleep(1.5)
        return True

    # Fallback (solo si el helper nativo no existe)
    try:
        from engine.takasho.schema.lettuce_server.player_api import friend_send_requests_v1_pb2
        Request = friend_send_requests_v1_pb2.FriendSendRequestsV1.Types.Request
        Response = friend_send_requests_v1_pb2.FriendSendRequestsV1.Types.Response

        field_name, is_repeated = _discover_send_requests_field(Request)
        if field_name is None:
            return False

        if is_repeated:
            batch_size = 2
            import time
            for i in range(0, len(target_pids), batch_size):
                batch = target_pids[i:i + batch_size]
                req = Request(**{field_name: list(batch)})
                try:
                    sess._call("/takasho.schema.lettuce_server.player_api.Friend/SendRequestsV1", req, Response)
                except Exception as exc:
                    if "ABORTED" in str(exc): return False
                if i + batch_size < len(target_pids):
                    time.sleep(1.5)
        else:
            import time
            for i, pid in enumerate(target_pids):
                req = Request(**{field_name: pid})
                try:
                    sess._call("/takasho.schema.lettuce_server.player_api.Friend/SendRequestsV1", req, Response)
                except Exception as exc:
                    if "ABORTED" in str(exc): return False
                if i < len(target_pids) - 1:
                    time.sleep(1.0)
        return True
    except Exception as exc:
        log(f"[!] SendRequestsV1 fallback failed: {str(exc)[:200]}")
        return False


_delete_field_cache: dict = {"name": None, "repeated": None, "logged": False}


def _discover_delete_field(Request) -> tuple[Optional[str], Optional[bool]]:
    """Same as _discover_send_requests_field but for Friend/DeleteV1."""
    if _delete_field_cache["name"] is not None:
        return _delete_field_cache["name"], _delete_field_cache["repeated"]
    try:
        fields = Request.DESCRIPTOR.fields_by_name
    except Exception:
        return None, None

    LABEL_REPEATED = 3
    plural_candidates = [
        "delete_player_ids", "player_ids", "target_player_ids",
        "unfriend_player_ids", "remove_player_ids",
    ]
    singular_candidates = [
        "delete_player_id", "player_id", "target_player_id",
        "unfriend_player_id", "remove_player_id",
    ]

    for name in plural_candidates:
        f = fields.get(name)
        if f is not None and getattr(f, "label", 0) == LABEL_REPEATED:
            _delete_field_cache.update({"name": name, "repeated": True})
            return name, True
    for name in singular_candidates:
        if name in fields:
            _delete_field_cache.update({"name": name, "repeated": False})
            return name, False

    for name, f in fields.items():
        try:
            if getattr(f, "label", 0) == LABEL_REPEATED and "player" in name.lower():
                _delete_field_cache.update({"name": name, "repeated": True})
                return name, True
        except Exception:
            pass
    for name, f in fields.items():
        try:
            if "player" in name.lower():
                _delete_field_cache.update({"name": name, "repeated": False})
                return name, False
        except Exception:
            pass
    return None, None


def _current_friend_pids(sess, tag: str = "") -> set[str]:
    """
    Return the set of player_ids currently in this session's friend list.
    Uses the GameSession helper `sess.get_friend_list()` (matches auto_trade
    line 590). Returns empty set on any failure — safer to try DeleteV1 on
    everyone than to fail silently.
    """
    try:
        r = sess.get_friend_list()
    except Exception as exc:
        log(f"[!] get_friend_list failed: {str(exc)[:200]}", tag=tag)
        return set()
    if not isinstance(r, dict) or not r.get("success"):
        return set()
    pids: set[str] = set()
    for f in r.get("friends", []) or []:
        pid = getattr(f, "player_id", "") or ""
        if not pid and isinstance(f, dict):
            pid = f.get("player_id", "")
        if pid:
            pids.add(pid)
    return pids


def unfriend_many(sess, target_pids: list[str], max_retries: int = 3,
                  tag: str = "") -> bool:
    """
    Delete one or more friends. Mirrors auto_trade.py's unfriend() line 772
    verbatim: one RPC call per pid, hardcoded `delete_player_ids=[pid]`,
    exact route path.

    Previous version (with field discovery and batched calls) returned
    True on success but the friend actually stayed on the collector's
    phone — most likely because the server only processed the first pid
    in a batched request, or silently discarded the whole batch.

    Retries transient RPC errors per-pid. Falls back to sess.delete_friend()
    only if the raw call keeps failing. Considers the whole batch successful
    only if every pid was accepted.
    """
    if not target_pids:
        return True

    try:
        from engine.takasho.schema.lettuce_server.player_api import friend_delete_v1_pb2
    except ImportError:
        # Fall back entirely to the session helper — matches auto_trade's
        # secondary path.
        helper = getattr(sess, "delete_friend", None) or getattr(sess, "unfriend", None)
        if not callable(helper):
            log(f"[!] Friend/DeleteV1: no proto and no session helper", tag=tag)
            return False
        all_ok = True
        for pid in target_pids:
            try:
                helper(pid)
                log(f"[+] Friend/DeleteV1: unfriended {pid} (via session helper)", tag=tag)
            except Exception as exc:
                log(f"[!] session helper failed for {pid}: {str(exc)[:200]}",
                    tag=tag)
                all_ok = False
        return all_ok

    Request = friend_delete_v1_pb2.FriendDeleteV1.Types.Request
    Response = friend_delete_v1_pb2.FriendDeleteV1.Types.Response
    helper = getattr(sess, "delete_friend", None) or getattr(sess, "unfriend", None)

    all_ok = True
    for pid in target_pids:
        last_err = ""
        attempts_done = 0
        pid_ok = False
        for attempt in range(1, max_retries + 1):
            attempts_done = attempt
            try:
                req = Request(delete_player_ids=[pid])
                sess._call(
                    "/takasho.schema.lettuce_server.player_api.Friend/DeleteV1",
                    req,
                    Response,
                )
                log(f"[+] Friend/DeleteV1: unfriended {pid}", tag=tag)
                pid_ok = True
                break
            except Exception as exc:
                last_err = str(exc)[:200]
                if attempt < max_retries and _is_transient_rpc_error(last_err):
                    delay = 1.5 * attempt
                    log(f"[.] Friend/DeleteV1 {pid} attempt {attempt}/"
                        f"{max_retries} transient, retrying in {delay:.1f}s: "
                        f"{last_err[:100]}", tag=tag)
                    time.sleep(delay)
                    continue
                break

        # Per-pid fallback to session helper if the raw call kept failing.
        if not pid_ok and callable(helper):
            try:
                helper(pid)
                log(f"[+] Friend/DeleteV1: unfriended {pid} (via session helper "
                    f"after {attempts_done} raw attempt(s))", tag=tag)
                pid_ok = True
            except Exception as exc:
                log(f"[!] session unfriend helper failed for {pid}: "
                    f"{str(exc)[:200]}", tag=tag)

        if not pid_ok:
            log(f"[!] Friend/DeleteV1 failed for {pid} after "
                f"{attempts_done} attempt(s): {last_err[:200]}", tag=tag)
            all_ok = False

    return all_ok


# ══════════════════════════════════════════════════════════════════════
# Pack opening + god pack detection
# ══════════════════════════════════════════════════════════════════════

# Wire field number for PackUnpackOrder.pack_table_id (from friend's headless bot).
# Confirmed: field 7 in the unpack_order message. God pack table = ends with "_02".
PACK_TABLE_ID_FIELD = 7


def _read_varint(data: bytes, pos: int):
    shift = 0
    result = 0
    while True:
        b = data[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not (b & 0x80):
            return result, pos
        shift += 7


def _unknown_string(msg, field_num: int) -> str:
    """
    Read a string field by number from the serialized message.
    Used because our stale pb2 may not have pack_table_id defined.
    """
    try:
        raw = msg.SerializeToString()
    except Exception:
        return ""
    pos = 0
    while pos < len(raw):
        key, pos = _read_varint(raw, pos)
        wire = key & 7
        fnum = key >> 3
        if wire == 0:
            _, pos = _read_varint(raw, pos)
        elif wire == 1:
            pos += 8
        elif wire == 2:
            length, pos = _read_varint(raw, pos)
            value = raw[pos:pos + length]
            pos += length
            if fnum == field_num:
                try:
                    return value.decode("utf-8")
                except Exception:
                    return ""
        elif wire == 5:
            pos += 4
        else:
            break
    return ""


def _is_transient_rpc_error(exc_str: str) -> bool:
    """
    True when an RPC error looks like a proxy/network hiccup we should retry:
    captive-portal HTML responses, gRPC UNAVAILABLE/DEADLINE, 5xx gateway
    errors, connection resets. Excludes hard app-level rejections.
    """
    s = str(exc_str)
    if not s:
        return False
    # Captive-portal / gateway HTML in the details field — proxy died mid-session
    if "<!doctype html>" in s.lower() or "<html" in s.lower():
        return True
    markers = (
        "UNAVAILABLE", "DEADLINE_EXCEEDED", "RESOURCE_EXHAUSTED",
        "502", "503", "504", "reset", "Reset", "EOF",
        "timed out", "Timeout", "connection", "Connection",
    )
    return any(m in s for m in markers)


def _pack_power_id(p) -> str:
    """
    The field name is `pack_power_id` on this build (confirmed from the
    field dump), NOT the shorter `power_id` I originally guessed. Try
    both so we work on either shape.
    """
    for name in ("pack_power_id", "power_id", "id"):
        v = getattr(p, name, "")
        if v:
            return str(v)
    return ""


def _effective_pack_power(p, now_ts: Optional[float] = None) -> int:
    """
    Compute the CURRENT pack power for one PackPower entry, including
    recharge accrued since the last checkpoint.

    Server returns `amount` at the last checkpoint (`last_auto_healed_at`),
    NOT the live value — the client computes:
        effective = min(auto_heal_limit,
                        amount + floor((now - last_healed) / heal_sec_per_power))
    Verified against the reference pack_power.py.
    """
    try:
        amount = int(getattr(p, "amount", 0) or 0)
        limit = int(getattr(p, "auto_heal_limit", 0) or 0)
        sec_per = int(getattr(p, "heal_sec_per_power", 0) or 0)
        if amount >= limit or sec_per <= 0:
            return amount
        last_healed = getattr(p, "last_auto_healed_at", None)
        checkpoint = int(getattr(last_healed, "seconds", 0) or 0) if last_healed else 0
        if checkpoint <= 0:
            return amount
        now = now_ts if now_ts is not None else time.time()
        elapsed = now - checkpoint
        healed = int(elapsed // sec_per) if elapsed > 0 else 0
        return max(0, min(limit, amount + healed))
    except Exception:
        return 0


def _seconds_until_next_recharge(p, now_ts: Optional[float] = None) -> int:
    """Seconds until this pack_power gains its next point. 0 if already full."""
    try:
        amount = int(getattr(p, "amount", 0) or 0)
        limit = int(getattr(p, "auto_heal_limit", 0) or 0)
        sec_per = int(getattr(p, "heal_sec_per_power", 0) or 0)
        if amount >= limit or sec_per <= 0:
            return 0
        last_healed = getattr(p, "last_auto_healed_at", None)
        checkpoint = int(getattr(last_healed, "seconds", 0) or 0) if last_healed else 0
        if checkpoint <= 0:
            return 0
        now = int(now_ts if now_ts is not None else time.time())
        elapsed = now - checkpoint
        healed = int(elapsed // sec_per) if elapsed > 0 else 0
        if amount + healed >= limit:
            return 0
        next_tick = checkpoint + (healed + 1) * sec_per
        return max(0, next_tick - now)
    except Exception:
        return 0


_pack_power_schema_logged = {"logged": False}


def _dump_pack_power_entry(p, tag: str = "") -> None:
    """One-time full dump of every field on a PackPower message so we can
    see exactly what the server returned and diagnose stored=0 effective=0."""
    try:
        fields = p.DESCRIPTOR.fields_by_name
    except Exception:
        return
    parts = []
    for name in fields:
        try:
            val = getattr(p, name, None)
            # Format Timestamp/Duration submessages sensibly
            if hasattr(val, "seconds") and hasattr(val, "nanos"):
                secs = getattr(val, "seconds", 0)
                iso = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(secs)) if secs else "0"
                parts.append(f"{name}={secs}({iso})")
            else:
                s = str(val)
                if len(s) > 60:
                    s = s[:60] + "..."
                parts.append(f"{name}={s}")
        except Exception:
            pass
    log(f"[PACK_POWER FIELDS] {' | '.join(parts)}", tag=tag)


def get_pack_power(sess, max_retries: int = 3, tag: str = "",
                    force_try_purchase: bool = False,
                    target_power_id: str = "PACK_POWER_NORMAL") -> int:
    """
    Return total available PACK_POWER_NORMAL, using effective (recharge-aware)
    accounting. Retries transient RPC errors.

    Return values:
      >= 0  server-reported power count (0 = truly drained)
      -1    RPC failed after every retry (proxy dead / network gone) —
            caller must NOT interpret this as "drained", or a healthy
            account gets falsely cooldowned. Distinguishing this from a
            real 0 is Level-1 of the proxy-death fix, since only the login
            step rotates proxies and everything downstream is stuck on
            whichever one login used.

    First call this process, dumps every field on the PackPower message so
    we can see exactly what the server returned when the count comes out
    weird (e.g. stored=0 effective=0 despite the account clearly having power).
    """
    from engine.takasho.schema.lettuce_server.player_api import pack_get_pack_power_v1_pb2
    Request = pack_get_pack_power_v1_pb2.PackGetPackPowerV1.Types.Request
    Response = pack_get_pack_power_v1_pb2.PackGetPackPowerV1.Types.Response

    # (wr98) First Partners / SP1: the special power pool. The exact power_id the server reports is kept on
    # sess._discovered_special_power_id so PurchaseV2 uses it.
    want_special = (target_power_id and target_power_id != "PACK_POWER_NORMAL")
    last_err = ""
    for attempt in range(1, max_retries + 1):
        try:
            resp = sess._call(
                "/takasho.schema.lettuce_server.player_api.Pack/GetPackPowerV1",
                Request(),
                Response,
            )
            total_normal = 0
            total_special = 0
            total_all = 0
            debug_parts = []
            next_wait_parts = []
            for p in resp.pack_powers:
                pid = _pack_power_id(p)
                stored = int(getattr(p, "amount", 0) or 0)
                effective = _effective_pack_power(p)
                debug_parts.append(f"pid='{pid}' stored={stored} effective={effective}")
                if pid == "PACK_POWER_NORMAL":
                    total_normal += effective
                else:
                    total_special += max(stored, effective)
                    if pid:
                        try:
                            sess._discovered_special_power_id = pid
                        except Exception:
                            pass
                total_all += effective
                if not _pack_power_schema_logged["logged"]:
                    _dump_pack_power_entry(p, tag=tag)
                    _pack_power_schema_logged["logged"] = True
                # If we're going to skip this account, tell the user WHEN it will
                # actually have a pack to open. Skip the log when the account has
                # power already.
                if effective == 0:
                    secs = _seconds_until_next_recharge(p)
                    if secs > 0:
                        eta = time.strftime("%Y-%m-%d %H:%M",
                                            time.localtime(time.time() + secs))
                        hours = secs / 3600.0
                        next_wait_parts.append(
                            f"{pid or '?'} +1 in {hours:.1f}h (at {eta})")
            if debug_parts:
                log(f"pack_powers[{len(debug_parts)}]: {' | '.join(debug_parts)}",
                    tag=tag)
            if next_wait_parts:
                log(f"  next recharge: {' | '.join(next_wait_parts)}", tag=tag)
            if want_special:
                if total_special > 0:
                    return total_special
                # (wr98) The server may not list the special power: return 1 so PurchaseV2 tries the free claim.
                log("[sp1] special pack selected; attempting 1 free pack claim", tag=tag)
                return 1
            if total_normal > 0:
                return total_normal
            if total_all > 0:
                log(f"[!] no PACK_POWER_NORMAL but {total_all} effective power "
                    f"under other id(s) — using it", tag=tag)
                return total_all
            return 0
        except Exception as exc:
            last_err = str(exc)[:200]
            if attempt < max_retries and _is_transient_rpc_error(last_err):
                delay = 1.5 * attempt
                log(f"[.] GetPackPowerV1 attempt {attempt}/{max_retries} "
                    f"transient, retrying in {delay:.1f}s: {last_err[:100]}",
                    tag=tag)
                time.sleep(delay)
                continue
            break
    # 2026-11-06 (Ale): ABORTED with no HTML = the account has another session open right now (its owner,
    # another bot or another host), NOT a dead proxy. -2 so the login health check doesn't burn the proxy;
    # plain info line (no "[!]") so the panel doesn't fill with red.
    if "ABORTED" in last_err and "<html" not in last_err.lower() and "<!doctype" not in last_err.lower():
        log("[info] GetPackPowerV1 ABORTED - this account seems to be open somewhere else right now", tag=tag)
        return -2
    log(f"[!] GetPackPowerV1 failed after {attempt} attempt(s): {last_err[:200]}",
        tag=tag)
    # -1 = RPC unavailable, NOT "0 power". Callers use this to skip the
    # cooldown stamp so a proxy-dead account doesn't get flagged drained
    # and locked out for 24h.
    return -1


_do_share_field_cache: dict = {"mode": None, "name": None, "logged": False}


# Wire-format constant for do_share=true (field 7, varint, value 1).
# Confirmed against a real client capture: creation_log.txt every PurchaseV2
# body carries "doShare": true. The compiled pb2 in this project (and in
# the reference code the friend uses) does NOT expose the field, so we
# append it to the serialized bytes as an unknown field. Protobuf preserves
# unknown fields at the wire level, and the server reads field 7 either way.
_DO_SHARE_TRUE_BYTES = b"\x38\x01"   # (7 << 3) | 0 = 0x38, then 0x01 = true


class _RawProto:
    """Wrapper that lets sess._call() send arbitrary bytes as the request
    body — used to inject unknown-field extras like do_share=true."""
    def __init__(self, payload: bytes):
        self._payload = payload

    def SerializeToString(self) -> bytes:
        return self._payload


def _apply_do_share(req, tag: str = ""):
    """
    Return the request with doShare=true set. If the pb2 has a native
    do_share (or doShare / share / …) bool field, we set that. Otherwise
    we append the raw wire bytes (7:varint=1) — exactly what the real
    client sends and what the friend's `with_do_share_true` helper does.

    Returns the request-like object to actually send (either the mutated
    original, or a _RawProto wrapper).
    """
    # Fast path — mode already decided this process
    mode = _do_share_field_cache["mode"]
    if mode == "native":
        try:
            setattr(req, _do_share_field_cache["name"], True)
        except Exception:
            pass
        return req
    if mode == "raw":
        return _RawProto(req.SerializeToString() + _DO_SHARE_TRUE_BYTES)

    # First call — pick a mode
    try:
        fields = req.DESCRIPTOR.fields_by_name
    except Exception:
        fields = {}

    for candidate in ("do_share", "doShare", "share", "is_shared", "shared"):
        f = fields.get(candidate)
        if f is not None and getattr(f, "type", 0) == 8:  # TYPE_BOOL
            try:
                setattr(req, candidate, True)
                _do_share_field_cache.update({"mode": "native", "name": candidate})
                if not _do_share_field_cache["logged"]:
                    log(f"[+] PurchaseV2: {candidate}=True "
                        f"(native pb2 field — pack is Wonder-Pickable)", tag=tag)
                    _do_share_field_cache["logged"] = True
                return req
            except Exception:
                continue

    # Fallback: inject as raw unknown field bytes (matches real client wire)
    _do_share_field_cache["mode"] = "raw"
    if not _do_share_field_cache["logged"]:
        log(f"[+] PurchaseV2: injecting do_share=true as raw field 7 "
            f"(pb2 lacks the field — pack is Wonder-Pickable)", tag=tag)
        _do_share_field_cache["logged"] = True
    return _RawProto(req.SerializeToString() + _DO_SHARE_TRUE_BYTES)


def _feed_share(sess, transaction_id: str, tag: str = "") -> bool:
    """
    Call Feed/ShareV1 with the PurchaseV2 transaction id. Best-effort:
    logs a warning on failure but never raises. The real client fires this
    right after every pack open, matching the same transactionId as the
    PurchaseV2 that produced the pack.
    """
    if not transaction_id:
        return False
    try:
        from engine.takasho.schema.lettuce_server.player_api import feed_share_v1_pb2
        Request = feed_share_v1_pb2.FeedShareV1.Types.Request
        Response = feed_share_v1_pb2.FeedShareV1.Types.Response
        req = Request(transaction_id=str(transaction_id))
        sess._call(
            "/takasho.schema.lettuce_server.player_api.Feed/ShareV1",
            req,
            Response,
        )
        return True
    except ImportError:
        # pb2 not generated in this project — try a session helper
        helper = getattr(sess, "feed_share", None) or getattr(sess, "share_feed", None)
        if callable(helper):
            try:
                helper(str(transaction_id))
                return True
            except Exception as exc:
                log(f"[!] Feed/ShareV1 helper failed: {str(exc)[:200]}", tag=tag)
        else:
            log(f"[!] Feed/ShareV1: no pb2 module or session helper "
                f"(feed_share_v1_pb2 missing)", tag=tag)
    except Exception as exc:
        log(f"[!] Feed/ShareV1 failed: {str(exc)[:200]}", tag=tag)
    return False


def _pack_get_detail(sess, pack_id: str, max_retries: int = 3, tag: str = ""):
    """GetDetailV2 with transient-error retries. Returns the response or None."""
    from engine.takasho.schema.lettuce_server.player_api import pack_get_detail_v2_pb2
    Request = pack_get_detail_v2_pb2.PackGetDetailV2.Types.Request
    Response = pack_get_detail_v2_pb2.PackGetDetailV2.Types.Response
    last_err = ""
    for attempt in range(1, max_retries + 1):
        try:
            return sess._call(
                "/takasho.schema.lettuce_server.player_api.Pack/GetDetailV2",
                Request(pack_id=pack_id),
                Response,
            )
        except Exception as exc:
            last_err = str(exc)[:200]
            if attempt < max_retries and _is_transient_rpc_error(last_err):
                delay = 1.5 * attempt
                log(f"[.] Pack/GetDetailV2 attempt {attempt}/{max_retries} "
                    f"transient, retrying in {delay:.1f}s: {last_err[:100]}",
                    tag=tag)
                time.sleep(delay)
                continue
            break
    log(f"[!] Pack/GetDetailV2 failed: {last_err[:200]}", tag=tag)
    return None


def open_pack(sess, pack_id: str, product_id: str, tag: str = "",
              hg_cost: int = 0, power_id: str = "PACK_POWER_NORMAL") -> Optional[dict]:
    """
    Open one pack via Pack/GetDetailV2 + PackShop/PurchaseV2.

    GetDetailV2 is idempotent — safe to retry freely.
    PurchaseV2 spends pack power — retry only on transient network errors
    where the request likely never reached the server. Retrying a purchase
    that DID complete would just get a duplicate-transaction rejection,
    which we treat as one failed open (not a double-charge).
    """
    try:
        from engine.takasho.schema.lettuce_server.player_api import (
            pack_get_detail_v2_pb2,
            pack_shop_purchase_v2_pb2,
        )

        # 1. Get pack detail for consistency token — retries built in.
        detail = _pack_get_detail(sess, pack_id, tag=tag)
        if detail is None:
            return None
        consistent_token = getattr(detail, "pack_consistent_token", "")

        # 2. Purchase pack (uses 1 PACK_POWER_NORMAL) with a bounded retry.
        Request = pack_shop_purchase_v2_pb2.PackShopPurchaseV2.Types.Request
        Response = pack_shop_purchase_v2_pb2.PackShopPurchaseV2.Types.Response

        result = None
        last_err = ""
        for attempt in range(1, 3):  # 1 retry
            try:
                purchase_req = Request(
                    pack_consistent_token=consistent_token,
                    transaction_id=str(uuid.uuid4()),
                    product_id=product_id,
                    amount=Request.Types.Amount.AMOUNT_ONE,
                )
                effective_power_id = power_id or "PACK_POWER_NORMAL"
                if effective_power_id != "PACK_POWER_NORMAL":
                    discovered = getattr(sess, "_discovered_special_power_id", "")
                    if discovered:
                        effective_power_id = discovered
                
                # --- LOGICA SP1 CORREGIDA ---
                if pack_id.startswith("SP"):
                    log(f"[sp1] Procesando sobre especial de bienvenida {pack_id}", tag=tag)
                    purchase_req.product_id = product_id if product_id else "PC_PS_2610010_01_01_01"
                    try:
                        result = sess._call(
                            "/takasho.schema.lettuce_server.player_api.PackShop/PurchaseV2",
                            _apply_do_share(purchase_req, tag=tag),
                            Response,
                        )
                    except Exception as first_exc:
                        if "INTERNAL" in str(first_exc):
                            log(f"[sp1] Advertencia en compra directa, intentando método alternativo: {first_exc}", tag=tag)
                            alt_candidates = [
                                ("PC_PS_2610000_01_01_01", effective_power_id),
                                ("PC_PS_2610010_01_01_01", "PACK_POWER_NORMAL"),
                                ("PC_PS_2609000_01_01_01", effective_power_id),
                            ]
                            for alt_prod, alt_pow in alt_candidates:
                                try:
                                    detail_alt = _pack_get_detail(sess, pack_id, max_retries=1, tag=tag)
                                    if detail_alt is not None:
                                        consistent_token = getattr(detail_alt, "pack_consistent_token", consistent_token)
                                    req_alt = Request(
                                        pack_consistent_token=consistent_token,
                                        transaction_id=str(uuid.uuid4()),
                                        product_id=alt_prod,
                                        amount=Request.Types.Amount.AMOUNT_ONE,
                                    )
                                    u_alt = req_alt.use_powers.add()
                                    u_alt.power_id = alt_pow
                                    u_alt.amount = 1
                                    result = sess._call(
                                        "/takasho.schema.lettuce_server.player_api.PackShop/PurchaseV2",
                                        _apply_do_share(req_alt, tag=tag),
                                        Response,
                                    )
                                    purchase_req = req_alt
                                    log(f"[sp1] PurchaseV2 OK with fallback product_id={alt_prod} power_id={alt_pow}", tag=tag)
                                    break
                                except Exception:
                                    continue
                            if result is None:
                                raise first_exc
                        else:
                            raise first_exc
                else:
                    use = purchase_req.use_powers.add()
                    use.power_id = effective_power_id
                    use.amount = 1
                    if hg_cost > 0:
                        try:
                            from engine.takasho.schema.lettuce_server.resource.item import (
                                pack_power_charger_pb2,
                            )
                            T = pack_power_charger_pb2.PackPowerCharger.Types.Type
                            charger = purchase_req.heal_items.chargers.add()
                            charger.type = T.TYPE_LARGE
                            charger.amount = int(hg_cost)
                        except Exception as exc:
                            log(f"[!] heal_items build failed (continuing without): "
                                f"{str(exc)[:200]}", tag=tag)
                    
                    request_to_send = _apply_do_share(purchase_req, tag=tag)
                    result = sess._call(
                        "/takasho.schema.lettuce_server.player_api.PackShop/PurchaseV2",
                        request_to_send,
                        Response,
                    )
                # --- FIN LOGICA SP1 ---

                # Feed/ShareV1
                _feed_share(sess, purchase_req.transaction_id, tag=tag)
                break
            except Exception as exc:
                last_err = str(exc)[:200]
                if attempt < 2 and _is_transient_rpc_error(last_err):
                    log(f"[.] PurchaseV2 attempt {attempt}/2 transient, "
                        f"retrying in 2.0s: {last_err[:100]}", tag=tag)
                    time.sleep(2.0)
                    # Refresh the consistency token before retrying
                    detail2 = _pack_get_detail(sess, pack_id, max_retries=2, tag=tag)
                    if detail2 is not None:
                        consistent_token = getattr(detail2, "pack_consistent_token",
                                                    consistent_token)
                    continue
                break
        if result is None:
            hint = ""
            if "ABORTED" in last_err:
                hint = (" — server says no pack power (JSON's lastPackPulled "
                        "may be stale, or another tool opened packs since)")
                try:
                    sess._gp_no_power = True
                except Exception:
                    pass
            elif "PERMISSION_DENIED" in last_err:
                hint = " — proxy returned captive-portal HTML; proxy is dead"
            log(f"[!] PurchaseV2 failed: {last_err[:200]}{hint}", tag=tag)
            return None

        # 3. Extract cards + god pack flag from unpack_orders
        cards: list[str] = []
        table_ids: list[str] = []
        for order in result.unpack_orders:
            table_id = _unknown_string(order, PACK_TABLE_ID_FIELD)
            table_ids.append(table_id)
            for stock in order.produces.card_instances:
                cid = getattr(stock.card_instance, "card_id", "")
                if cid:
                    amount = int(getattr(stock, "amount", 1) or 1)
                    cards.extend([cid] * amount)

        table_str = ",".join(t for t in table_ids if t)
        primary_table = next((t for t in table_ids if t), table_str)

        info = gp_cards.classify_pack(cards, primary_table)
        label = info["label"]
        summary = gp_cards.summarize_cards(cards)

        if info["is_god_pickable"]:
            tag_str = f" <-- GOD PACK {label} (WONDER-PICKABLE)"
        elif info["is_god_unpickable"]:
            tag_str = f" <-- [!!] god pack drawn but UNPICKABLE ({label})"
        elif info["is_rare_2sr"]:
            tag_str = f" <-- RARE PACK (2xSR - GP&Double eligible)"
        elif info["is_rare_1sr"]:
            tag_str = f" <-- rare (1xSR - not enough for GP&Double)"
        else:
            tag_str = ""

        log(f"pack opened cards={len(cards)} table={table_str or '?'}{tag_str}", tag=tag)
        log(f"  cards: {summary}", tag=tag)

        return {
            "pack_info": info,
            "god_pack": info["is_god_pickable"],
            "god_pack_raw": info["is_god_table"],
            "wonder_pickable": not info["is_god_unpickable"],
            "god_pack_category": label,
            "unpickable_rarities": info.get("unpickable_rarities", []),
            "cards": cards,
            "pack_table_id": table_str,
            "summary": summary,
        }
    except Exception as exc:
        exc_msg = str(exc)[:200].encode('ascii', 'replace').decode('ascii')
        log(f"[!] pack open failed: {exc_msg}", tag=tag)
        return None


# ══════════════════════════════════════════════════════════════════════
# Per-account injection worker
# ══════════════════════════════════════════════════════════════════════

def _cleanup_links(sess, account: dict, target_pids: list[str], tag: str) -> bool:
    """Delete accepted + cancel pending FRs with every collector, verify, and
    close the ledger entry on success. Never raises."""
    try:
        ok = fr_cleanup.cleanup_collector_links(
            sess, target_pids, log=lambda m, t=tag: log(str(m), tag=t))
    except Exception as exc:
        log(f"[fr-cleanup] [!] cleanup crashed: {str(exc)[:200]}", tag=tag)
        ok = False
    if ok:
        fr_cleanup.ledger_close(account["account_key"])
    return ok


def sweep_fr_ledger(reason: str, scope: str = "stale") -> tuple[int, int]:
    """
    Log back into every account still in the FR ledger (reports/fr_pending/) and remove
    all collector links. Runs at startup (leftovers from a crash / force-kill)
    and once more right before the process exits. Ignores the stop event on
    purpose — this IS the stop cleanup.
    scope 'stale' = left by a process that is gone; 'mine' = this process (final sweep). Accounts another
    running inject.py is still using are never touched. Lent accounts are only cleaned when their XML is
    in this run's --xml-dir (Monitor Pokemon brings it back from the owner's Monitor Link).
    Returns (cleaned, still_dirty).
    """
    entries = {}
    for key, e in _fr_scan(scope).items():
        if e.get("owner"):
            xml = os.path.join(_SWEEP_XML_DIR, e.get("xml_file", "")) if _SWEEP_XML_DIR else ""
            if not (xml and e.get("xml_file") and os.path.isfile(xml)):
                continue   # lent account whose XML isn't here: Monitor Pokemon cleans it with its owner's XML
            if e.get("owner") != _fr_owner():
                continue
            e["xml_path"] = xml
        entries[key] = e
    if not entries:
        log(f"[fr-sweep] {reason}: nothing to clean")
        return 0, 0
    log(f"[fr-sweep] {reason}: {len(entries)} account(s) still have FRs/friendships "
        f"with collectors - logging in for CLEANUP ONLY (no packs opened, "
        f"cooldown untouched)")
    cleaned = dirty = 0
    for key, e in entries.items():
        tag = e.get("nickname") or key
        creds = _parse_xml_creds(e.get("xml_path", "")) if e.get("xml_path") else {}
        pwd = creds.get("devicePassword", "").strip()
        acct_id = creds.get("deviceAccount", "").strip() or e.get("account_id", "")
        if not pwd or not acct_id:
            log(f"[fr-sweep] [!] {key}: XML missing/moved ({e.get('xml_path')}) - "
                f"cannot log in; left in ledger", tag=tag)
            dirty += 1
            continue
        acct = {
            "account_key": e.get("account_key") or key, "nickname": tag, "account_id": acct_id,
            "password": pwd, "xml_path": e.get("xml_path", ""),
            "json_path": e.get("json_path", ""),
            "device_identifier": e.get("device_identifier", ""),
            "authorize_device_account": e.get("authorize_device_account", ""),
        }
        sess = login_account(acct, max_retries=3)
        if sess is None:
            log(f"[fr-sweep] [!] {key}: login failed - left in ledger for next run",
                tag=tag)
            dirty += 1
            continue
        try:
            if _cleanup_links(sess, acct, e.get("target_pids", []), tag):
                cleaned += 1
                try:
                    Path(e["_file"]).unlink()   # entry of another (dead) run: close it by its own file
                except Exception:
                    pass
            else:
                dirty += 1
        finally:
            try:
                sess.close()
            except Exception:
                pass
    log(f"[fr-sweep] {reason}: cleaned={cleaned} still_dirty={dirty}"
        + (f"  (see {fr_cleanup.ledger_path()})" if dirty else ""))
    return cleaned, dirty


def inject_one(
    account: dict,
    friend_codes: list[str],
    packs: int,
    pack_id: str,
    product_id: str,
    wait_accept: float,
    dry_run: bool,
    verify_power: bool = False,
    run_mode: str = "godpack",           # "godpack" or "packs-only"
    farming_mode: str = "only_gp",       # "only_gp" | "gp_double" | "gp_single"
    pack_power_min: str = "1/5",         # 1/5..5/5 threshold
    pack_delay: float = 2.0,             # base seconds between packs (±20% jitter)
    account_delay: float = 2.0,          # base seconds between accounts (used by caller)
    accept_timeout: float = 0.0,         # 0 = disabled, use fixed wait_accept
    send_likes: bool = False,            # after packs, send Collection/LikeV1 per like target
    like_codes_file: str = "",           # text file of like targets (separate from GP collectors)
    like_codes: Optional[list[str]] = None,
    allow_likes: bool = False,
    dismiss_popups: bool = True,         # before packs, flip welcome/60hg popup flags
    min_hourglass: int = 0,              # skip account if fewer LARGE hourglasses than this
    hg_cost: int = 0,                    # LARGE hourglasses to spend PER pack in PurchaseV2
    power_id: str = "PACK_POWER_NORMAL", # (wr98) PACK_POWER_NORMAL or PACK_POWER_SPECIAL (SP1)
) -> dict:
    """
    Run the full injection flow for one account.
    Sends friend requests to ALL collectors at once, opens packs, then
    keeps friendship intact on ALL collectors if any god pack, else
    unfriends all collectors.
    Returns a result dict with 'god_pack', 'packs_opened', 'error', 'friend_status'.
    """
    tag = account["nickname"]
    result = {
        "account_key": account["account_key"],
        "account_id": account["account_id"],
        "nickname": tag,
        "god_pack": False,
        "packs_opened": 0,
        "error": None,
        "friend_status": "unfriended",
        "cards": [],
        "pack_table_id": "",
        "collector_count": len(friend_codes),
    }

    # 1. Login
    sess = login_account(account, max_retries=max(1, _proxy_rotations))
    if sess is None:
        result["error"] = "login_failed"
        # Classify + quarantine if the caller enabled it. Transient errors
        # (proxy / tunnel issues) are left alone so the account retries
        # next run — only real auth blocks or unknown failures get moved.
        # Classified ALWAYS (2026-11-06, Ale): a likely ban is written to reports/banned_accounts.jsonl even
        # when quarantine is off (GP farm lent accounts), so Monitor Pokemon can warn the owner.
        if True:
            try:
                from scripts.flow.errors import classify_login_failure
            except ImportError:
                classify_login_failure = None  # graceful degrade
            info = account.get("_login_failure", {}) or {}
            proxies_tried_n = len(info.get("proxies_tried", []) or [])
            err_obj = info.get("last_error_obj")
            err_str = info.get("last_error_str", "") or "unknown"
            classification = "unknown_failure"
            if classify_login_failure is not None:
                try:
                    classification = classify_login_failure(err_obj, proxies_tried_n)
                except Exception:
                    pass
            # Nintendo BaaS failing (e.g. "idToken missing", HTTP errors) happens BEFORE the game
            # server sees the account, so it says nothing about a ban: retry next run instead of
            # moving the file. 2026-11-06 (Ale): BaaS refused every login and 159 good accounts
            # were sent to QUARANTINE/unknown_failure.
            if "BaaS login failed" in err_str or err_str.startswith("account_in_use"):
                classification = "transient"   # account open elsewhere: never quarantine it
            if err_str.startswith("account_in_use"):
                # Not a failure of this run (no auto-stop count, no red): the account is just busy elsewhere.
                result["error"] = "account_in_use"
                # 2026-11-07 (Arcade): a LOCKED account ("This account is currently locked") answers exactly
                # like one that is open elsewhere, so it was retried forever. Still "in use" on 3 runs over
                # 6+ hours = treated as likely banned (banned list for lent accounts, QUARANTINE for own ones).
                if _in_use_strike(account.get("account_key", ""), tag):
                    _note_banned(account, "account_in_use on 3 runs over 6+ hours (account locked?)", 0, tag)
                    result["error"] = "login_failed (likely_banned)"
                    if getattr(_qopts, "enabled", False):
                        _quarantine_account(
                            account, "likely_banned",
                            "Classification: likely_banned\n"
                            f"Timestamp: {time.strftime('%Y-%m-%d %H:%M:%S')}\n"
                            "The game answered 'open somewhere else' (ABORTED) on 3 runs over 6+ hours: "
                            "the account is most likely locked.\n",
                            skip_list_path=_qopts.skip_list_path, tag=tag,
                        )
                return result
            if classification == "likely_banned":
                _note_banned(account, err_str, proxies_tried_n, tag)
            if classification != "transient" and getattr(_qopts, "enabled", False):
                reason_text = (
                    f"Classification: {classification}\n"
                    f"Timestamp: {time.strftime('%Y-%m-%d %H:%M:%S')}\n"
                    f"Attempts: {info.get('attempts', 0)}\n"
                    f"Proxies tried ({proxies_tried_n}):\n" +
                    "\n".join(f"  - {p}" for p in info.get("proxies_tried", [])) +
                    f"\n\nLast error:\n{err_str}\n"
                )
                _quarantine_account(
                    account, classification, reason_text,
                    skip_list_path=_qopts.skip_list_path, tag=tag,
                )
            if classification != "transient":
                result["error"] = f"login_failed ({classification})"
        return result

    try:
        # Hoisted so the except-block cleanup can access them regardless of
        # where an exception fires. Without this, the safety-net unfriend
        # in `except` would NameError if the exception happened before we
        # reached the FR-send section.
        target_pids: list[str] = []
        pid_to_friend_code: dict[str, str] = {}  # Maps UUID -> 16-digit friend code for send_like()
        fr_was_sent = False          # flipped True after send_friend_requests OK
        any_match = False            # any pack matched the wishlist (keep-friend trigger)
        # Free pack power the account had BEFORE we started opening. Used
        # by the smart-mix loop below so packs 1..N (N = free power) go
        # out with empty healItems (cost 0 LARGE), and packs N+1..M carry
        # heal_items=[LARGE, hg_cost] to spend hourglasses. Set from the
        # verify_power fetches further down; 0 means "unknown or drained"
        # and the loop then treats every pack as paid.
        free_power_at_start = 0

        # 1b. Pre-flight: dismiss the "welcome back" and "60HG mission
        # accomplished" popups on old/dormant accounts. Reads
        # PlayerStorage.PlayerComeBackData--1, flips two msgpack booleans
        # from false→true, writes it back. Idempotent: if both flags are
        # already true (fresh accounts, or same account run twice today),
        # it no-ops after the Get. Safe against missing pb2 / RPC errors
        # — always advisory, never fails the run.
        if dismiss_popups and not dry_run:
            try:
                gp_popups.dismiss_first_login_popups(sess, log_fn=log, tag=tag)
            except Exception as exc:
                log(f"[popup] unexpected error (continuing): {str(exc)[:200]}",
                    tag=tag)

        # 1c. Optional: hourglass minimum. When min_hourglass > 0, skip
        # the account if it has fewer LARGE pack-power chargers than
        # required (12 per paid pack; a 10-pack run needs 120). An RPC
        # failure returns count=-1 → treated as "unknown", we proceed
        # rather than false-skipping.
        if min_hourglass > 0 and not dry_run:
            ok_hg, hg_count, hg_err = gp_resources.enough_hourglasses(
                sess, needed=min_hourglass, hg_type="LARGE")
            if not ok_hg and hg_count >= 0:
                log(f"[hourglass] skip: have {hg_count} LARGE < "
                    f"required {min_hourglass}", tag=tag)
                result["error"] = f"hourglass_below_min ({hg_count}/{min_hourglass})"
                return result
            elif not ok_hg and hg_err:
                log(f"[hourglass] unknown ({hg_err}) — proceeding without gate",
                    tag=tag)
            else:
                log(f"[hourglass] ok: {hg_count} LARGE >= {min_hourglass}",
                    tag=tag)

  # 2. Resolve every friend code → player_id.
        # Needed in godpack mode only (to send FRs). Likes use their own
        # target file and are resolved separately in step 5c.
        needs_target_pids = (run_mode == "godpack")
        if needs_target_pids:
            live_codes = fetch_live_worker_codes(friend_codes)
            while not live_codes and not _stop_event.is_set():
                log("[!] 0 usuarios online en el Worker; esperando 10s...", tag=tag)
                time.sleep(10.0)
                live_codes = fetch_live_worker_codes(friend_codes, ttl_sec=0)
            log(f"[worker-elite] {len(live_codes)} ID(s) online detectados: {', '.join(live_codes)}", tag=tag)
            live_codes = _limit_collectors(live_codes, friend_codes)
            for code in live_codes:
                pid = resolve_friend_code(sess, code)
                if pid:
                    target_pids.append(pid)
                    # Store mapping for send_like() to access friend_code later
                    # Strip dashes from friend code for the 16-digit format
                    code_digits = "".join(c for c in code if c.isdigit())
                    pid_to_friend_code[pid] = code_digits
                else:
                    log(f"[!] skipping unresolvable code: {code}", tag=tag)
            if run_mode == "godpack" and not target_pids:
                # In godpack mode, no collectors = no reason to open packs.
                result["error"] = "no_collectors_resolved"
                return result
            if target_pids:
                log(f"collectors resolved: {len(target_pids)} of {len(friend_codes)}",
                    tag=tag)
        else:
            log(f"[packs-only mode] no friend requests will be sent", tag=tag)

        # 3. Verify pack power SERVER-SIDE. Always on in godpack mode now:
        # the JSON's metadata.lastPackPulled can be stale (leannew racing us,
        # or our record_pack_openings never firing because 0 packs opened).
        # Trusting the server prevents wasted FRs on drained accounts AND
        # lets us bump lastPackPulled ourselves so the cooldown gate skips
        # this account on the next run.
        #
        # If the server reports fewer packs than the user requested, we cap
        # the pack count so we don't waste an FR just to open 1 pack of the
        # requested 2. Community rule: "1 or 2" packs — if 0, skip.
        last_pack_pulled = account.get("last_pack_pulled", "") or "(unknown)"
        if run_mode == "godpack":
            power = get_pack_power(sess, tag=tag, target_power_id=power_id)
            # NOTE: -1 = RPC failed (proxy dead). Treat as "unknown power" —
            # smart-mix falls back to always-paid so heal_items refills for
            # every open. free_power_at_start clamps negatives to 0.
            free_power_at_start = max(0, int(power))
            if power < 0:
                log(f"verify_power: RPC failed (unknown power, proxy likely "
                    f"dead) — will NOT stamp cooldown, will attempt packs "
                    f"anyway (paid ones auto-refill via heal_items)", tag=tag)
            else:
                log(f"verify_power: server reports {power} pack(s) "
                    f"(JSON lastPackPulled={last_pack_pulled})", tag=tag)
            # Only skip + cooldown when the server ACTUALLY confirmed 0
            # power. -1 (RPC unavailable) means we don't know — never
            # stamp cooldown on an unknown state, or a healthy account
            # gets locked out for 24h because of a dead proxy.
            if power == 0:
                # Cooldown-bug safety net: bump lastPackPulled ourselves so
                # discover_accounts() skips this account for cooldown_hours.
                # Without this, we'd re-pick the same drained account every
                # single run.
                json_path = account.get("json_path", "")
                if json_path and not dry_run:
                    bumped = gp_json.bump_last_pack_pulled(
                        json_path,
                        log_fn=lambda m: log(str(m), tag=tag),
                    )
                    if bumped:
                        log(f"bumped lastPackPulled - won't re-inject this "
                            f"account until cooldown clears", tag=tag)

                # Clean-run: sweep any leftover friendships with our collectors
                # from a previous crashed/interrupted run. Best-effort.
                if target_pids and not dry_run:
                    try:
                        current_friends = _current_friend_pids(sess, tag=tag)
                        stale = [p for p in target_pids if p in current_friends]
                        if stale:
                            log(f"[cleanup] {len(stale)} stale FR(s) from prior "
                                f"run - unfriending before skip", tag=tag)
                            unfriend_many(sess, stale, tag=tag)
                    except Exception as exc:
                        log(f"[!] cleanup sweep failed: {str(exc)[:200]}", tag=tag)

                if not dry_run:
                    gp_state.mark_power_used(account["account_key"], "server_zero_power")
                result["error"] = "verify_power_zero (server says no power)"
                log(f"skipping - server says 0 packs. Not sending FR.", tag=tag)
                return result

            # --full-power-only (GP farm, Ale 2026-11-06): only accounts with ALL their free packs
            # recharged; one with 1 of 2 is skipped (no FR sent) and retried once it is full.
            if _skip_partial_power(power, packs, hg_cost, result, tag):
                return result

            # Cap requested pack count at what the server actually has.
            # Server usually reports 1 or 2 for a healthy account (24h+
            # cooldown). Only cap on a FREE pack (rocket, hg_cost==0)
            # AND only when we KNOW the real power (power >= 0); paid
            # packs refill from hourglasses per open, so the power
            # ceiling doesn't apply for those.
            if hg_cost <= 0 and power >= 0 and power < packs:
                log(f"capping packs {packs} → {power} (server-reported "
                    f"free power)", tag=tag)
                packs = int(power)
            elif hg_cost > 0:
                # Smart mix: use the account's free pack power first,
                # then spend hourglasses for the remaining opens. If
                # power is unknown (-1), free_power_at_start==0 so every
                # pack is treated as paid.
                free_used = min(free_power_at_start, packs)
                paid_used = max(0, packs - free_used)
                total_hg = paid_used * hg_cost
                if power < 0:
                    log(f"paid pack mix: power unknown, treating all "
                        f"{packs} as paid × {hg_cost} LARGE "
                        f"= {total_hg} LARGE", tag=tag)
                else:
                    log(f"paid pack mix: {free_used} free "
                        f"+ {paid_used} paid × {hg_cost} LARGE "
                        f"= {total_hg} LARGE for {packs} packs", tag=tag)

        elif verify_power:
            # packs-only mode with explicit --verify-power: same guard,
            # no FR cleanup needed since we never sent any.
            power = get_pack_power(sess, tag=tag, target_power_id=power_id)
            # -1 = RPC dead; treat as unknown, don't cooldown, don't skip.
            free_power_at_start = max(0, int(power))
            if power < 0:
                log(f"verify_power: RPC failed (unknown power, proxy likely "
                    f"dead) — will NOT stamp cooldown, will attempt packs "
                    f"anyway", tag=tag)
            else:
                log(f"verify_power: server reports {power} pack(s)", tag=tag)
            # Only skip + stamp cooldown when we KNOW the account has 0
            # power AND the pack has no hourglass path (rocket). For paid
            # packs, even 0 power is fine — heal_items will refill per
            # PurchaseV2.
            if power == 0 and hg_cost <= 0:
                # Free pack (rocket): zero power == no more opens today.
                json_path = account.get("json_path", "")
                if json_path and not dry_run:
                    gp_json.bump_last_pack_pulled(
                        json_path,
                        log_fn=lambda m: log(str(m), tag=tag),
                    )
                if not dry_run:
                    gp_state.mark_power_used(account["account_key"], "server_zero_power")
                result["error"] = "verify_power_zero (server says no power)"
                log(f"skipping - server says 0 packs.", tag=tag)
                return result

            if _skip_partial_power(power, packs, hg_cost, result, tag):
                return result

            # Cap: only when heal_items is NOT being sent (rocket).
            # For a paid pack (hg_cost > 0), each PurchaseV2 refills
            # 1 pack power for 12 LARGE via heal_items and then spends
            # that refilled power via use_powers — so pack power is
            # never the ceiling; hourglasses are. That gate already
            # ran back in step 1c via --min-hourglass.
            if hg_cost <= 0 and power >= 0 and power < packs:
                log(f"capping packs {packs} → {power} (server-reported "
                    f"free power)", tag=tag)
                packs = int(power)
            elif hg_cost > 0:
                free_used = min(free_power_at_start, packs)
                paid_used = max(0, packs - free_used)
                total_hg = paid_used * hg_cost
                if power < 0:
                    log(f"paid pack mix: power unknown, treating all "
                        f"{packs} as paid × {hg_cost} LARGE "
                        f"= {total_hg} LARGE", tag=tag)
                else:
                    log(f"paid pack mix: {free_used} free "
                        f"+ {paid_used} paid × {hg_cost} LARGE "
                        f"= {total_hg} LARGE for {packs} packs", tag=tag)

        # 4. Send friend request to all collectors (godpack mode only).
        if run_mode == "godpack":
            if dry_run:
                log(f"[dry-run] would send friend requests to {len(target_pids)} collectors", tag=tag)
            else:
                # NEW: per-collector pack-open budget (shared across every
                # inject.py process on this machine via .pack_budget.json).
                # Each collector pid has its own N/min window; a batch send
                # waits for the busiest collector in the batch. No-op when
                # --packs-per-min is 0.
                _throttle_pack_budget(int(packs), target_pids=target_pids, tag=tag)
                _throttle_fr_send(target_pids)   # legacy per-collector FR budget (dormant if --fr-per-min=0)
                # Ledger FIRST: if we crash / get killed from here on, the
                # final sweep (or the next run's startup sweep) cleans up.
                fr_cleanup.ledger_open(account, target_pids)
                fr_was_sent = True
                fr_ok = send_friend_requests(sess, target_pids, tag)
                # One by one only when a Main refused (full list); not when the proxy itself is blocked.
                if not fr_ok and len(target_pids) > 1 and not getattr(_fr_state, "proxy_blocked", False):
                    # (2026-11-01) El paquete falla entero (ABORTED) si UNO de los collectors tiene la
                    # lista de amigos llena, y la cuenta se saltaba sin abrir (487 veces en un dia).
                    # Se reintenta de a uno: la cuenta sigue con los que aceptaron, y los que rechazan
                    # mientras otros aceptan quedan en reports/collectors_full.jsonl (anti doble reroll:
                    # un main lleno con muy pocas cuentas nuestras = acepta solicitudes de otro grupo).
                    ok_pids = list(getattr(_fr_state, "sent_ok", []) or [])
                    full_pids = []
                    for pid in [p for p in target_pids if p not in ok_pids]:
                        (ok_pids if send_friend_requests(sess, [pid], tag) else full_pids).append(pid)
                    if ok_pids:
                        if full_pids:
                            _note_full_collectors(full_pids, pid_to_friend_code, tag)
                            _pause_collectors([pid_to_friend_code.get(p, "") for p in full_pids], tag)
                            log(f"[fr] {len(full_pids)} collector(s) rejected the request (friend list full?); "
                                f"continuing with {len(ok_pids)}", tag=tag)
                        target_pids = ok_pids
                        fr_ok = True
                if not fr_ok:
                    result["error"] = "friend_request_failed"
                    # Some FRs may have landed (pending OR accepted) before the
                    # error. Withdraw/delete all of them.
                    log(f"[cleanup] FR send failed - withdrawing any that landed",
                        tag=tag)
                    if _cleanup_links(sess, account, target_pids, tag):
                        result["friend_status"] = "unfriended (send failed)"
                    else:
                        result["friend_status"] = "unfriend_failed (send failed)"
                    return result
                # Two accept-wait strategies:
                #   1. Poll mode (accept_timeout > 0): check the friend list
                #      every 2s and open packs the moment ALL sent FRs land.
                #      On timeout, cancel pending FRs and skip the account.
                #   2. Fixed sleep (accept_timeout == 0): original behavior --
                #      sleep wait_accept seconds regardless of accept state.
                if accept_timeout and accept_timeout > 0:
                    log(f"friend requests sent to {len(target_pids)} collectors; "
                        f"polling up to {accept_timeout}s for accept "
                        f"(check every 2s)", tag=tag)
                    deadline = time.time() + float(accept_timeout)
                    accepted = False
                    while time.time() < deadline:
                        if _stop_event.is_set():
                            log(f"[stop-signal] detected during polling - cleaning up FRs", tag=tag)
                            if _cleanup_links(sess, account, target_pids, tag):
                                result["friend_status"] = "unfriended (stop signal)"
                                result["error"] = "stopped_by_user"
                            else:
                                result["friend_status"] = "unfriend_failed (stop signal)"
                                result["error"] = "stopped_by_user_cleanup_failed"
                            return result
                        try:
                            current = _current_friend_pids(sess, tag=tag)
                        except Exception as exc:
                            log(f"[!] accept poll: friend list read failed: "
                                f"{str(exc)[:150]}", tag=tag)
                            current = set()
                        if all(p in current for p in target_pids):
                            accepted = True
                            landed = len([p for p in target_pids if p in current])
                            log(f"all {landed}/{len(target_pids)} FR(s) accepted; "
                                f"opening packs", tag=tag)
                            break
                        time.sleep(2.0)
                    if not accepted:
                        # Timeout expired -- cancel pending FRs (DeleteV1 is a
                        # no-op on already-declined pairs, safe for partial
                        # accepts too) and skip the account without opening
                        # packs. Match the friend_status vocabulary used by
                        # the friend_request_failed path above.
                        log(f"[timeout] no accept within {accept_timeout}s; "
                            f"cancelling FRs and skipping account", tag=tag)
                        if _cleanup_links(sess, account, target_pids, tag):
                            result["friend_status"] = "unfriended (accept timeout)"
                        else:
                            result["friend_status"] = "unfriend_failed (accept timeout)"
                        result["error"] = "accept_timeout"
                        return result
                else:
                    log(f"friend requests sent to {len(target_pids)} collectors; "
                        f"waiting {wait_accept}s for accept", tag=tag)
                    
                    # Handle stop signal during accept wait
                    deadline = time.time() + wait_accept
                    while time.time() < deadline:
                        if _stop_event.is_set():
                            log(f"[stop-signal] detected - cleaning up FRs", tag=tag)
                            if _cleanup_links(sess, account, target_pids, tag):
                                result["friend_status"] = "unfriended (stop signal)"
                                result["error"] = "stopped_by_user"
                            else:
                                result["friend_status"] = "unfriend_failed (stop signal)"
                                result["error"] = "stopped_by_user_cleanup_failed"
                            return result
                        
                        remaining = deadline - time.time()
                        if remaining <= 0:
                            break
                        time.sleep(min(0.5, remaining))

        # 5. Open packs
        # any_match already initialized at top of try (needed by except handler)
        any_god_raw = False       # any _02 table, pickable or not
        any_unpickable = False    # crown/shiny/immersive
        match_slot = 0            # 1st or 2nd pack that hit (for Clean/Dirty)
        all_cards: list[str] = []
        per_pack_cards: list[list[str]] = []   # for JSON pulls[] registration
        table_ids_seen: list[str] = []
        pack_labels: list[str] = []
        attempts = 0
        for i in range(packs):
            if dry_run:
                log(f"[dry-run] would open pack {i+1}/{packs}", tag=tag)
                continue
            attempts += 1
            # Smart mix per pack. If we still have free pack power left,
            # send empty healItems (free). Once free power runs out,
            # send heal_items=[LARGE, hg_cost] to refill from hourglasses.
            # Rocket (hg_cost=0) always sends empty healItems, unchanged.
            per_pack_hg = 0 if i < free_power_at_start else int(hg_cost)
            if hg_cost > 0 and per_pack_hg == 0:
                remaining = free_power_at_start - i - 1
                log(f"[pack {i+1}/{packs}] FREE (using recharged power, "
                    f"{remaining} free left after this)", tag=tag)
            outcome = open_pack(sess, pack_id, product_id, tag=tag,
                                hg_cost=per_pack_hg, power_id=power_id)
            if outcome is None:
                log(f"pack {i+1}/{packs} did NOT open - breaking out of loop", tag=tag)
                break
            result["packs_opened"] += 1
            all_cards.extend(outcome["cards"])
            per_pack_cards.append(outcome["cards"])
            if outcome["pack_table_id"]:
                table_ids_seen.append(outcome["pack_table_id"])

            info = outcome.get("pack_info") or {}
            pack_labels.append(info.get("label", "?"))
            if info.get("is_god_table"):
                any_god_raw = True
            if info.get("is_god_unpickable"):
                any_unpickable = True
            # Debug: dump the full classification so the user can eyeball
            # what the bot actually saw for each opened pack. Useful when
            # deciding whether the new gp_single mode is behaving correctly
            # or when spot-checking god-pack detection.
            log(f"[classify] pack {i+1}/{packs}: label={info.get('label','?')} "
                f"god_table={info.get('is_god_table')} "
                f"god_pickable={info.get('is_god_pickable')} "
                f"god_unpickable={info.get('is_god_unpickable')} "
                f"is_rare_2sr={info.get('is_rare_2sr')} "
                f"is_rare_1sr={info.get('is_rare_1sr')} "
                f"two_star_count={info.get('two_star_count')} "
                f"unpickable_rarities={info.get('unpickable_rarities')} "
                f"god_table_missed={info.get('god_table_missed')}",
                tag=tag)

            # Diagnostic: the rarity-based fallback fired, meaning the pack
            # was god-shaped (>=3 SR/SAR, nothing unpickable) but the
            # server's table_id did NOT end in "_02". Dump the raw
            # table_ids we saw for every unpack_order plus the first two
            # card_id strings so we can figure out what the real god
            # suffix / field number is for this pack family (BN010 rocket,
            # or whichever) and tighten the _02 check next.
            if info.get("god_table_missed"):
                _tids = outcome.get("pack_table_id", "") or "(empty)"
                _cids = outcome.get("cards", []) or []
                _cids_head = ",".join(_cids[:2]) if _cids else "(none)"
                log(f"[classify-fallback] pack {i+1}/{packs} caught by "
                    f"rarity heuristic — raw table_ids={_tids} "
                    f"first_card_ids={_cids_head} "
                    f"total_cards={len(_cids)} pack_id={pack_id}", tag=tag)

            # Wishlist match — only meaningful in godpack mode.
            if run_mode == "godpack":
                matched = gp_cards.matches_wishlist(info, farming_mode, pack_power_min)
                # Diagnostic: show pack tier vs threshold and the verdict so
                # the user can eyeball that 2/5-threshold really keeps 2+ only.
                _tier_label = info.get("label", "?")
                if info.get("is_god_unpickable"):
                    _verdict = "UNPICKABLE (unfriend)"
                elif matched:
                    _verdict = "MATCH (keep)"
                else:
                    _verdict = "below threshold (unfriend)"
                log(f"[threshold] pack={_tier_label} threshold={pack_power_min} "
                    f"farming={farming_mode} → {_verdict}", tag=tag)
                if matched:
                    if not any_match:
                        match_slot = i + 1   # first matching pack's 1-based index
                    any_match = True
                    # Keep-worthy pack: take the account out of the ledger NOW
                    # so no later sweep can unfriend a real god pack.
                    fr_cleanup.ledger_close(account["account_key"])
                    # ── ENVÍO AUTOMÁTICO A DISCORD (IMAGEN + TEXTO) ──
                    # 2026-11-06 (Arcade): a long run keeps the notifier it loaded at start; if Monitor
                    # Pokemon updated discord_notifier.py meanwhile, the alert used the old code and the GP
                    # never reached KyuremBot. Reload it right before every God Pack.
                    _notifier = _gp_notifier()
                    if _notifier is None:
                        log(f"[discord] GOD PACK NOT POSTED: the God Pack notifier could not load "
                            f"({_gp_discord_error or 'unknown error'}) - run: python -m pip install -r requirements.txt pillow",
                            tag=tag)
                    else:
                        try:
                            import importlib
                            importlib.reload(_notifier)   # updates the same module object in place
                        except Exception:
                            pass
                        _notifier.notify_god_pack_async(
                            account=account,
                            card_ids=outcome["cards"],
                            pack_label=_tier_label,
                            packs_count=packs,
                            pack_id=pack_id,
                            sess=sess,
                            log_fn=lambda m: log(str(m), tag=tag),
                        )

            if i < packs - 1:
                # Adjustable pack-open delay: base value ±20% jitter.
                # Bumped from the old hardcoded uniform(1.5, 3.0) so users can
                # slow the loop down when the server starts rate-limiting.
                pd = max(0.1, float(pack_delay))
                time.sleep(random.uniform(pd * 0.8, pd * 1.2))

        # Offline-cooldown bookkeeping: packs spent, or server refused for
        # no power -> this account must not be touched again for cooldown_hours.
        # (Timeouts / stops / FR failures never reach here with packs spent,
        # so those accounts keep their eligibility.)
        if not dry_run:
            if result["packs_opened"] > 0:
                gp_state.mark_power_used(account["account_key"], "packs_opened")
            elif getattr(sess, "_gp_no_power", False):
                gp_state.mark_power_used(account["account_key"], "purchase_no_power")
                gp_json.bump_last_pack_pulled(
                    account.get("json_path", ""),
                    log_fn=lambda m: log(str(m), tag=tag))
                log(f"server refused purchase (no power) - cooldown recorded, "
                    f"account will be skipped offline next run", tag=tag)

        # Clean/Dirty labels (community convention for 2-pack runs)
        clean_dirty = ""
        if run_mode == "godpack" and packs >= 2 and any_match:
            clean_dirty = " [Clean]" if match_slot == 1 else " [Dirty]"

        # One-line per-account outcome summary
        if run_mode == "packs-only":
            outcome_str = f"opened {result['packs_opened']}/{packs} packs"
        elif any_match:
            outcome_str = (f"opened {result['packs_opened']}/{packs} packs, "
                           f"MATCH: {','.join(pack_labels)}{clean_dirty}")
        elif any_unpickable:
            outcome_str = (f"opened {result['packs_opened']}/{packs} packs, "
                           f"unpickable god pack ({','.join(pack_labels)})")
        else:
            outcome_str = (f"opened {result['packs_opened']}/{packs} packs, "
                           f"no match ({','.join(pack_labels) or '-'})")
        log(f"-- ACCOUNT SUMMARY: {outcome_str}", tag=tag)

        result["god_pack"] = any_match           # "match" in the new lingo
        result["god_pack_raw"] = any_god_raw
        result["god_pack_category"] = ",".join(pack_labels)
        result["clean_dirty"] = clean_dirty.strip()
        result["cards"] = all_cards
        result["pack_table_id"] = ",".join(table_ids_seen)

        # 5b. Register the pack opens into the account JSON in the
        # PTCGPB-leannew schema (pulls[], registeredCards[], packCount,
        # lastPackPulled). This also bumps lastPackPulled so our own
        # cooldown gate correctly skips this account on the next run.
        if per_pack_cards and not dry_run:
            wrote = gp_json.record_pack_openings(
                json_path=account.get("json_path", ""),
                pack_id=pack_id,
                packs=per_pack_cards,
                log_fn=lambda m: log(str(m), tag=tag),
            )
            if wrote:
                log(f"registered {len(per_pack_cards)} pack(s) into "
                    f"{os.path.basename(account.get('json_path', ''))}", tag=tag)
            # Same notice the Lean bot sends to its S4T (personal server channels by
            # rarity / wishlist / god pack). Only accounts of this PC, never lent ones.
            try:
                from scripts.god_pack import s4t_notifier
                s4t_notifier.notify_packs(account, pack_id, per_pack_cards,
                                          log_fn=lambda m: log(str(m), tag=tag))
            except Exception as exc:
                log(f"[s4t] notify failed: {exc}", tag=tag)

        # 5c. Optional: send a Collection/LikeV1 to each LIKE TARGET, guarded
        # by the "Send collection like" tick. Like targets come from their
        # own text file (--like-codes-file), NOT the god-pack collector list.
        # Ledger enforces: max 5 likes received per collector per day (all
        # farms combined, server rejections count too), 1/day/(farm,collector)
        # pair, reset at 11:30 IST. Failures never fail the run.
        if send_likes and allow_likes and result["packs_opened"] > 0 and not dry_run:
            reset_iso = gp_likes.window_end_iso()
            targets = like_codes if like_codes is not None else gp_likes.load_like_targets(
                like_codes_file)
            if not targets:
                log(f"[like] no targets in "
                    f"{gp_likes.like_targets_path(like_codes_file)} — skipping likes",
                    tag=tag)
            likes_sent_this_account = 0
            cap = gp_likes.MAX_LIKES_PER_COLLECTOR_PER_DAY
            for code in targets:
                fcode = gp_likes.friend_code_digits(code)
                if not fcode:
                    log(f"[like] skip {code}: need a 16-digit friend code "
                        f"(UUID alone isn't enough)", tag=tag)
                    continue
                cpid = resolve_friend_code(sess, code)
                if not cpid:
                    log(f"[like] skip: cannot resolve {code}", tag=tag)
                    continue
                # Atomically check limits + claim a slot (safe with --parallel).
                ok_can, reason, new_count = gp_likes.reserve_like(
                    account["account_key"], cpid)
                if not ok_can:
                    log(f"[like] skip: {reason} (resets at {reset_iso})", tag=tag)
                    continue
                ok_sent, err = gp_likes.send_like(sess, cpid, friend_code=fcode, tag=tag)
                if ok_sent:
                    likes_sent_this_account += 1
                    log(f"[like] farm={tag} → collector={cpid[:8]}... ✓ "
                        f"(collector {new_count}/{cap} today)", tag=tag)
                elif gp_likes.is_server_rejection(err):
                    # Game refused → collector already received likes; count it.
                    n = gp_likes.keep_rejected_like(account["account_key"], cpid, err)
                    log(f"[like] rejected by server: farm={tag} → collector={cpid[:8]}... "
                        f"— {err[len(gp_likes.REJECTED_PREFIX):]} "
                        f"(counted, collector {n}/{cap} today)", tag=tag)
                else:
                    gp_likes.release_like(account["account_key"], cpid)
                    log(f"[like] fail: farm={tag} → collector={cpid[:8]}... "
                        f"— {err}", tag=tag)
            if likes_sent_this_account:
                result["likes_sent"] = likes_sent_this_account

        # 6. Keep or unfriend based on wishlist match. Skipped in packs-only mode.
        if run_mode != "godpack":
            result["friend_status"] = "n/a"
        elif dry_run:
            log(f"[dry-run] would {'KEEP all' if any_match else 'UNFRIEND all'} "
                f"{len(target_pids)} collectors", tag=tag)
        else:
            if any_match:
                log(f"[MATCH] pack matched wishlist - keeping friendship "
                    f"with all {len(target_pids)} collectors{clean_dirty}", tag=tag)
                result["friend_status"] = "kept"
                fr_cleanup.ledger_close(account["account_key"])  # kept on purpose
            else:
                reason = "no wishlist match"
                if any_unpickable:
                    reason = (f"[!!] got god pack ({result['god_pack_category']}) "
                              f"but UNPICKABLE - unfriending")
                elif any_god_raw:
                    reason = (f"got god pack ({result['god_pack_category']}) "
                              f"below threshold - unfriending")
                # Give late accepts a moment to land, then check the actual list
                time.sleep(2.0)
                current_friends = _current_friend_pids(sess, tag=tag)
                actually_friends = [p for p in target_pids if p in current_friends]
                if actually_friends:
                    log(f"friend list check: {len(actually_friends)}/{len(target_pids)} "
                        f"collector(s) actually became friends", tag=tag)
                else:
                    log(f"friend list check: 0/{len(target_pids)} collectors "
                        f"in accepted-friends list (still pending or already gone)",
                        tag=tag)
                # DeleteV1 the WHOLE target set — safe if some aren't friends
                # (server returns success either way) and covers the case where
                # get_friend_list missed a late accept.
                if _cleanup_links(sess, account, target_pids, tag):
                    log(f"{reason}; all {len(target_pids)} collector links removed "
                        f"(accepted deleted + pending cancelled)", tag=tag)
                    result["friend_status"] = "unfriended"
                else:
                    log(f"{reason}; unfriend-all failed (will retry next run)",
                        tag=tag)
                    result["friend_status"] = "unfriend_failed"

    except Exception as exc:
        result["error"] = f"unexpected: {str(exc)[:200]}"
        log(f"[X] {exc}", tag=tag)
        # Safety net: if we sent FRs before this exception fired and never
        # got to the wishlist-match decision (or got there but couldn't
        # complete unfriend), sweep them now. Without this, a mid-flow
        # crash between step 4 (FR send) and step 6 (unfriend) leaves the
        # collector with pending FRs that never get cleaned up.
        if fr_was_sent and not any_match and target_pids and not dry_run:
            try:
                log(f"[cleanup] exception after FR send - sweeping "
                    f"{len(target_pids)} collector FR(s)", tag=tag)
                if _cleanup_links(sess, account, target_pids, tag):
                    result["friend_status"] = "unfriended (exception cleanup)"
                else:
                    result["friend_status"] = "unfriend_failed (exception)"
            except Exception as cleanup_exc:
                log(f"[!] exception-cleanup unfriend failed: "
                    f"{str(cleanup_exc)[:200]}", tag=tag)
                result["friend_status"] = "unfriend_failed (exception)"
    finally:
        try:
            sess.close()
        except Exception:
            pass

    return result


# ══════════════════════════════════════════════════════════════════════
# Main runner
# ══════════════════════════════════════════════════════════════════════

_stop_event = threading.Event()


# ══════════════════════════════════════════════════════════════════════
# Cross-process pack-open budget — PER COLLECTOR
# ─────────────────────────────────────────────────────────────────────
# PER-COLLECTOR ceiling on pack-opens per minute (e.g. 55/min per
# collector), shared across every inject.py process on this machine.
# Sid runs 15 GUI instances and needs each collector's total pack
# throughput capped at ONE number no matter how many processes are
# feeding it. Total across N collectors = N × ceiling.
#
# Backing store: <PROJECT_ROOT>/.pack_budget.json shape:
#   { "per_pid": { "<collector_pid>": [ts, ts, ...], ... } }
# Each pid gets its own list of reservation timestamps, pruned to the
# last 60s on every read. Cross-process safe via msvcrt (Windows) /
# lockf (POSIX) file locking, mirrors scripts/flow/proxy.py.
#
# Reservation model: at FR-send time we know how many packs this
# account will open (min(args.packs, verify_power) has already run) AND
# which collector pids are in this batch. We check EACH pid's own
# window; if any is full we wait for the busiest one, then reserve
# n_packs on every pid in the batch. On failure (verify_power=0, FR
# failed, accept timeout) no explicit release is needed — the entry
# ages out of the 60s window on its own.
# ══════════════════════════════════════════════════════════════════════
_PACK_BUDGET_FILE = str(PROJECT_ROOT / ".pack_budget.json")
_pack_budget_max_per_min: float = 0.0    # 0 = disabled; set from CLI


@contextlib.contextmanager
def _pack_budget_locked():
    """Cross-process locked read/write of the .pack_budget.json file.
    Yields the state dict; on clean exit, writes it back atomically."""
    lock_path = _PACK_BUDGET_FILE + ".lock"
    with open(lock_path, "a+b") as lock:
        if os.name == "nt":
            import msvcrt
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
        else:
            try:
                import fcntl
                fcntl.lockf(lock.fileno(), fcntl.LOCK_EX)
            except Exception:
                pass
        try:
            try:
                with open(_PACK_BUDGET_FILE, "r", encoding="utf-8") as fh:
                    state = json.load(fh)
            except Exception:
                state = {}
            # Per-collector shape: {"per_pid": {"<pid>": [ts, ...]}}
            if not isinstance(state.get("per_pid"), dict):
                state["per_pid"] = {}
            # Drop the legacy flat "opens" list from the earlier global
            # variant so it doesn't linger as dead data.
            state.pop("opens", None)
            yield state
            # (2026-11-06) tmp propio por proceso: con tus cuentas + las prestadas corren dos inject.py a la
            # vez y compartian ".tmp" -> uno renombraba el del otro ([Errno 2] .pack_budget.json.tmp en la Mac).
            tmp = f"{_PACK_BUDGET_FILE}.{os.getpid()}.tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(state, fh)
            os.replace(tmp, _PACK_BUDGET_FILE)
        finally:
            if os.name == "nt":
                try:
                    lock.seek(0)
                    msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
                except Exception:
                    pass
            else:
                try:
                    import fcntl
                    fcntl.lockf(lock.fileno(), fcntl.LOCK_UN)
                except Exception:
                    pass


COMMUNITY_PPM_CAP_V1 = True
_community_cap_cache = {"at": 0.0, "cap": None}


def _community_ppm_cap():
    """2026-11-07 (Ale): the community GP farm keeps ~36 packs/min per Main IN TOTAL. The Monitor bot writes
    reports/ppm_cap.json {cap, hosts, ts} = that total split among the hosts farming God Packs (one host alone
    gets all of it). None when missing or older than 5 min (then only the panel's own cap applies)."""
    now = time.time()
    if now - _community_cap_cache["at"] < 15:
        return _community_cap_cache["cap"]
    cap = None
    try:
        data = json.loads((PROJECT_ROOT / "reports" / "ppm_cap.json").read_text("utf-8")) or {}
        if now - float(data.get("ts", 0)) / 1000.0 < 300 and float(data.get("cap", 0)) > 0:
            cap = int(float(data["cap"]))
    except Exception:
        cap = None
    _community_cap_cache.update(at=now, cap=cap)
    return cap


SPACING_V1 = True
FR_RETRY_ONLY_UNSENT_V1 = True


def _throttle_pack_budget(n_packs: int, target_pids: list = None, tag: str = "") -> None:
    """Block until `n_packs` reservations fit in the last-60s window for
    EVERY collector pid in `target_pids`, then reserve `n_packs` on each.
    Per-collector cap: each pid has its own independent 60s window in
    .pack_budget.json → `per_pid`. Total throughput scales with collector
    count (N pids × ceiling).

    No-op when the budget is disabled (max_per_min <= 0), when the caller
    isn't going to open any packs (n_packs <= 0), or when no target pids
    are provided (packs-only mode)."""
    community_cap = _community_ppm_cap()
    if (_pack_budget_max_per_min <= 0 and community_cap is None) or n_packs <= 0:
        return
    pids = [p for p in (target_pids or []) if p]
    if not pids:
        return
    cap = int(_pack_budget_max_per_min) if _pack_budget_max_per_min > 0 else 10 ** 6
    if community_cap is not None:
        cap = min(cap, community_cap)
    cap = max(cap, int(n_packs))   # a cap below one account's packs would never open a slot
    logged_wait = False
    busiest_pid = ""
    while True:
        if _stop_event.is_set():
            return
        with _pack_budget_locked() as state:
            now = time.time()
            per_pid = state["per_pid"]
            # Prune each target pid's window to the last 60s.
            for pid in pids:
                per_pid[pid] = [
                    ts for ts in per_pid.get(pid, []) if now - ts < 60.0
                ]
            # Check EVERY pid — batch reserve only fires if all fit.
            max_wait = 0.0
            # 2026-11-07 (Ale/Arcade): spread the accounts evenly over the minute instead of releasing
            # several in the same second when the 60 s window frees up (bursts on every Main). Each account
            # waits n_packs * 60 / cap seconds after the previous one (cap 10, 2 packs -> one every 12 s).
            gap = SPACING_V1 and (60.0 * n_packs / max(cap, 1))
            for pid in pids:
                if per_pid[pid] and gap:
                    wait_gap = max(per_pid[pid]) + gap - now
                    if wait_gap > max_wait:
                        max_wait = wait_gap
                        busiest_pid = pid
            for pid in pids:
                used = len(per_pid[pid])
                if used + n_packs > cap:
                    # This pid is the bottleneck; how long until enough
                    # of its oldest slots age out?
                    need = used + n_packs - cap
                    when = sorted(per_pid[pid])[need - 1] + 60.0
                    wait = max(0.05, when - now)
                    if wait > max_wait:
                        max_wait = wait
                        busiest_pid = pid
            if max_wait <= 0:
                # All targets have room — reserve on each.
                for pid in pids:
                    per_pid[pid].extend([now] * n_packs)
                if logged_wait:
                    log(f"[pack-budget] slot opened; sending FR "
                        f"({len(per_pid[busiest_pid])}/{cap} "
                        f"in-window on busiest collector after reserve)",
                        tag=tag)
                return
        # Wait outside the lock (short slices so Stop is responsive).
        if not logged_wait:
            log(f"[pack-budget] pacing: friend requests in ~{max_wait:.1f}s "
                f"(max {cap} packs/min, one account every ~{60.0 * n_packs / max(cap, 1):.0f}s)", tag=tag)
            logged_wait = True
        time.sleep(min(max_wait + 0.1, 2.0))


# ══════════════════════════════════════════════════════════════════════
# Friend-request rate limiter
# The collector account has a Nintendo-side cap on how many friend requests
# it will ACCEPT per minute (~58/min in practice). This is a PER-COLLECTOR
# cap on the server side, so we throttle PER COLLECTOR too — each collector
# gets its own N/min budget rather than sharing one global budget.
#
# With 3 collectors + rate=58: total sends can now hit 3×58 = 174/min
# (each collector still capped at 58/min). Previously we throttled globally,
# which wasted throughput proportional to the collector count.
#
# send_friend_requests() sends to a BATCH of target pids in one RPC call,
# so we wait for the SLOWEST target's next slot — the batch send is
# constrained by whichever collector is closest to its 58/min ceiling.
# ══════════════════════════════════════════════════════════════════════
_fr_rate_lock = threading.Lock()
_fr_last_send_per_target: dict = {}   # pid -> last send timestamp
_fr_min_interval_s: float = 0.0       # 0 = no limit; set from CLI


def _throttle_fr_send(target_pids: list[str] = None):
    """
    Block until every target in `target_pids` is at least _fr_min_interval_s
    past its last send. Then stamp all of them with 'now'. Global (across
    parallel workers) so bots don't stampede the same collector.

    `target_pids=None` falls back to a legacy global-cap behavior for any
    callers that don't pass targets — kept only for safety, current code
    always passes targets.
    """
    if _fr_min_interval_s <= 0:
        return
    with _fr_rate_lock:
        now = time.time()
        if not target_pids:
            # Legacy path: single global slot keyed under "__global__".
            key = "__global__"
            wait = _fr_min_interval_s - (now - _fr_last_send_per_target.get(key, 0.0))
            if wait > 0:
                time.sleep(wait)
                now = time.time()
            _fr_last_send_per_target[key] = now
            return
        # Per-target: find the max wait across all targets in this batch.
        max_wait = 0.0
        for pid in target_pids:
            last = _fr_last_send_per_target.get(pid, 0.0)
            w = _fr_min_interval_s - (now - last)
            if w > max_wait:
                max_wait = w
        if max_wait > 0:
            time.sleep(max_wait)
            now = time.time()
        # Stamp all targets with the actual send time.
        for pid in target_pids:
            _fr_last_send_per_target[pid] = now


def run_injection(args) -> int:
    """Main entry — iterates accounts and runs injections."""
    started_at = time.time()
    # Tee output to file if requested (GUI's PowerShell tail window watches this).
    if getattr(args, "log_file", ""):
        _open_log_file(args.log_file)
        log(f"[log_file] mirroring all output to {args.log_file}")

    # --cleanup-only: just sweep leftover FRs from earlier runs, then exit.
    global _SWEEP_XML_DIR
    _SWEEP_XML_DIR = str(getattr(args, "xml_dir", "") or getattr(args, "accounts_dir", "") or "")
    if getattr(args, "cleanup_only", False):
        load_proxies(args.proxy_file, args.proxy_scheme)
        _, dirty = sweep_fr_ledger("cleanup-only")
        return 0 if dirty == 0 else 1

    # Parse collector codes (comma-separated, semicolon-separated, or newline-separated).
    # Each entry can be a 16-digit friend code (dashed or raw) or a UUID player_id.
# Parse collector codes (coma, punto y coma o saltos de línea)
    raw = str(args.collector_codes or "").strip()
    friend_codes_list = [
        c.strip() for c in re.split(r"[,;\n]+", raw) if c.strip()
    ]
    run_mode = getattr(args, "mode", "godpack")

    # SI ESTÁ VACÍO EN EL GUI, USAR AUTOMÁTICAMENTE EL WORKER
    if not friend_codes_list and run_mode == "godpack":
        friend_codes_list = ["https://onlineids.zenithrise.workers.dev/elite"]

    if not friend_codes_list and run_mode == "godpack":
        log("[X] no collector codes provided. Pass --collector-codes with at least one, "
            "or use --mode packs-only.")
        return 2
    if run_mode == "packs-only":
        log(f"[mode=packs-only] just opening {args.packs} pack(s) per account, "
            f"no friend requests")
    else:
        log(f"[mode=godpack] collectors={len(friend_codes_list)} "
            f"farming={args.farming_mode} threshold={args.pack_power_min}")

    # Resolve LARGE-hourglass cost per pack. Explicit --hg-cost overrides
    # the catalog; a value of -1 means "auto-infer from pack_catalog by
    # pack_id" (default). 0 = free pack (rocket path).
    hg_override = int(getattr(args, "hg_cost", -1))
    if hg_override >= 0:
        _resolved_hg_cost = hg_override
        _hg_source = "cli --hg-cost"
    else:
        try:
            from scripts.flow.pack_catalog import hg_cost_for_pack
            _resolved_hg_cost = int(hg_cost_for_pack(args.pack_id) or 0)
            _hg_source = "pack_catalog"
        except Exception as exc:
            _resolved_hg_cost = 0
            _hg_source = f"fallback (catalog import failed: {exc})"
    _resolved_power_id = str(getattr(args, "power_id", "") or "").strip()
    if not _resolved_power_id:
        try:
            from scripts.flow.pack_catalog import power_id_for_pack
            _resolved_power_id = power_id_for_pack(args.pack_id)
        except Exception:
            _resolved_power_id = "PACK_POWER_SPECIAL" if str(args.pack_id).upper().startswith("SP") else "PACK_POWER_NORMAL"
    log(f"hg_cost per pack: {_resolved_hg_cost} LARGE (source: {_hg_source}) | power_id: {_resolved_power_id}")
    if _resolved_hg_cost > 0 and args.packs > 2:
        # Sanity nudge — 10 paid packs = 120 LARGE. Without --min-hourglass
        # gate, a low-balance account will burn a login before getting
        # rejected mid-loop.
        min_hg = int(getattr(args, "min_hourglass", 0) or 0)
        recommended = args.packs * _resolved_hg_cost
        if min_hg < recommended:
            log(f"[hint] --packs {args.packs} at {_resolved_hg_cost} "
                f"LARGE/pack = {recommended} LARGE needed. "
                f"--min-hourglass is {min_hg}; consider {recommended} "
                f"to skip low-balance accounts before login.")

    # Proxy health and retry settings are shared by account workers.
    global _proxy_revive_seconds, _proxy_checks, _proxy_check_gap, _proxy_rotations
    _proxy_revive_seconds = max(
        0, int(getattr(args, "proxy_revive_seconds", 300) or 0))
    _proxy_checks = max(0, int(getattr(args, "proxy_checks", 3) or 0))
    _proxy_check_gap = max(0.0, float(getattr(args, "proxy_check_gap", 2.0) or 0.0))
    _proxy_rotations = max(1, int(getattr(args, "proxy_rotations", 3) or 1))

    # Load proxies
    load_proxies(args.proxy_file, args.proxy_scheme)
    _restore_proxy_health()

    # Optional: shuffle proxy pool at startup so every restart hits IPs in a
    # different order (helps rotate through the pool evenly and avoids the
    # same IPs always being tried first after a restart). All workers in
    # THIS process still share the shuffled order, so accounts stay in sync
    # with each other on which proxy comes next.
    if getattr(args, "shuffle_proxies", False):
        global _proxy_pool, _proxy_index
        with _proxy_lock:
            if _proxy_pool:
                random.shuffle(_proxy_pool)
                _proxy_index = 0
                log(f"[Proxy] shuffled {len(_proxy_pool)} proxies (--shuffle-proxies)")

    # Configure global FR rate limit
    global _fr_min_interval_s
    rate = float(getattr(args, "fr_per_min", 0) or 0)
    # 2026-11-06 (Ale): a Main got a friend soft-ban from too many requests. Never more than
    # FR_MAX_PER_MIN per collector (also when the panel sends 0 = "disabled").
    if rate <= 0 or rate > FR_MAX_PER_MIN:
        rate = FR_MAX_PER_MIN
    if rate > 0:
        _fr_min_interval_s = 60.0 / rate
        log(f"FR rate limit: max {rate:.0f} friend requests/min PER COLLECTOR "
            f"({_fr_min_interval_s:.2f}s between sends to any one collector)")
    else:
        _fr_min_interval_s = 0.0
        log("FR rate limit: disabled")

    # NEW: global pack-open budget (per-minute, ALL collectors + ALL
    # inject.py processes combined). File-locked via .pack_budget.json at
    # the project root. 0 = disabled (falls back to fr_per_min behavior).
    global _pack_budget_max_per_min, _max_collectors, _gp_eligibility
    _gp_eligibility = str(getattr(args, "gp_eligibility", "") or "")
    _max_collectors = int(getattr(args, "max_collectors", 0) or 0)
    ppm = float(getattr(args, "packs_per_min", 0) or 0)
    if ppm > 0:
        _pack_budget_max_per_min = ppm
        log(f"Pack-open budget: {int(ppm)}/min PER COLLECTOR "
            f"(shared across all inject.py instances via file lock) "
            f"— state at {_PACK_BUDGET_FILE}")
    else:
        _pack_budget_max_per_min = 0.0
        log("Pack-open budget: disabled (0/min)")

    # Wire quarantine options to module-level state so the login-fail path
    # in inject_one() and discover_accounts()'s skip-list check can see
    # them without threading extra args through 8 layers.
    _qopts.enabled = bool(getattr(args, "quarantine_locked", False))
    _qopts.skip_list_path = str(getattr(args, "skip_list", "") or _default_skip_list_path())
    if _qopts.enabled:
        log(f"quarantine: locked-account detection ON, "
            f"skip list = {_qopts.skip_list_path}")
    else:
        log("quarantine: locked-account detection OFF (failing accounts "
            "will retry next run instead of being moved)")

    # Cards DB — used for readable pack summaries and Wonder-Pick filtering.
    # If missing, pack outputs stay usable but show raw ids instead of names.
    _db = gp_cards.db_path()
    if _db:
        log(f"cards DB: {_db}")
    else:
        log("[!] no cards DB found — packs will show raw card ids only. "
            "Set PTCGP_CARDS_JSON, or place cards.json in god_pack/data/")

    # Leftovers from a crashed / force-killed previous run go first.
    if not args.dry_run:
        sweep_fr_ledger("startup (leftovers from previous run)")

    # Discover eligible accounts (XML dir + JSON dir override accounts_dir when set)
    accounts = discover_accounts(
        xml_dir=getattr(args, "xml_dir", None),
        json_dir=getattr(args, "json_dir", None),
        accounts_dir=args.accounts_dir,
        cooldown_hours=args.cooldown_hours,
    )
    if not accounts:
        # 2026-11-06 (Ale): not an error - every account is resting (opened in the last cooldown hours).
        # Plain text (no "[!]") so the panel doesn't paint it red; the community farm keeps going.
        log(f"[info] all your accounts are resting (opened in the last {args.cooldown_hours:g} h) - "
            f"nothing of yours to open right now. Lent accounts (Community farm) keep being opened.")
        return 0

    # Sort BEFORE applying --limit so "oldest first + limit 10" gives you the
    # 10 oldest eligible accounts, not the alphabetically-first 10.
    #
    # last_pack_pulled is a "YYYYMMDDHHMMSS" string set by PTCGPB-leannew (or
    # our bump_last_pack_pulled). It sorts correctly as a string. Accounts
    # that were NEVER opened have an empty string here — we treat those as
    # "infinitely old" (they've been waiting the longest to be used).
    sort_order = getattr(args, "sort_order", "filename")
    if sort_order == "oldest":
        # last_used_ts = newest of lastPackPulled / pulls[] / bot record.
        # Never-used accounts (0) come first — they've waited longest.
        accounts.sort(key=lambda a: a.get("last_used_ts", 0.0))
        log(f"sort: oldest first (by last use ascending)")
    elif sort_order == "newest":
        # Never-used accounts (0) go LAST here.
        accounts.sort(key=lambda a: a.get("last_used_ts", 0.0), reverse=True)
        log(f"sort: newest first (by last use descending, cooldown-respected)")
    else:
        # "filename" — preserves the existing alphabetical XML-glob order.
        # No sort needed; discover_accounts already returns them this way.
        pass

    if args.limit and args.limit > 0:
        accounts = accounts[: args.limit]
        log(f"limit={args.limit}; processing {len(accounts)} of eligible")

    send_likes = bool(getattr(args, "send_likes", False))
    like_codes: list[str] = []
    like_account_keys: set[str] = set()
    if send_likes:
        like_codes = gp_likes.load_like_targets(
            getattr(args, "like_codes_file", ""))
        if args.dry_run:
            log("[like] dry run; no 24-hour like cycle will be reserved")
            send_likes = False
        elif not like_codes:
            log(f"[like] no targets in "
                f"{gp_likes.like_targets_path(getattr(args, 'like_codes_file', ''))}; "
                "likes disabled")
            send_likes = False
        else:
            selected_like_accounts = accounts[:gp_likes.MAX_LIKE_ACCOUNTS_PER_RUN]
            like_account_keys = {
                account["account_key"] for account in selected_like_accounts
            }
            claimed, reason = gp_likes.claim_daily_cycle(
                [account["account_key"] for account in selected_like_accounts])
            if claimed:
                log(f"[like] 24-hour cycle started; only the first "
                    f"{len(selected_like_accounts)} selected account(s) may send likes")
            else:
                log(f"[like] disabled: {reason}")
                send_likes = False

    log(f"starting: accounts={len(accounts)} parallel={args.parallel} "
        f"packs={args.packs} pack_id={args.pack_id} wait_accept={args.wait_accept}s "
        f"collectors={len(friend_codes_list)}")

    processed = 0
    god_hits = 0
    errors = 0
    packs_opened_total = 0
    # Outcome buckets so the final summary tells the user what actually happened
    accounts_no_packs = 0        # login OK but PurchaseV2 never succeeded
    accounts_login_fail = 0
    accounts_aborted = 0         # server rejected as no-power / stale
    accounts_proxy_dead = 0      # captive-portal HTML
    accounts_opened_at_least_one = 0
    cards_pulled_total = 0

    def _worker(acct):
        if _stop_event.is_set():
            return None
        r = inject_one(
            acct,
            friend_codes=friend_codes_list,
            packs=args.packs,
            pack_id=args.pack_id,
            product_id=args.product_id,
            wait_accept=args.wait_accept,
            dry_run=args.dry_run,
            verify_power=getattr(args, "verify_power", False),
            run_mode=getattr(args, "mode", "godpack"),
            farming_mode=getattr(args, "farming_mode", "only_gp"),
            pack_power_min=getattr(args, "pack_power_min", "1/5"),
            pack_delay=getattr(args, "pack_delay", 2.0),
            account_delay=getattr(args, "account_delay", 2.0),
            accept_timeout=getattr(args, "accept_timeout", 0.0),
            send_likes=send_likes,
            like_codes_file=getattr(args, "like_codes_file", ""),
            like_codes=like_codes,
            allow_likes=acct["account_key"] in like_account_keys,
            dismiss_popups=getattr(args, "dismiss_popups", True),
            min_hourglass=int(getattr(args, "min_hourglass", 0) or 0),
            hg_cost=_resolved_hg_cost,
            power_id=_resolved_power_id,
        )
        # Record state (touch mtime only on successful attempt)
        _record_kwargs = dict(
            account_key=r["account_key"],
            account_id=r["account_id"],
            nickname=r["nickname"],
            packs_opened=r["packs_opened"],
            god_pack_found=r["god_pack"],
            god_pack_cards=r["cards"] if r["god_pack"] else None,
            pack_id=args.pack_id,
            pack_table_id=r["pack_table_id"] if r["god_pack"] else None,
            friend_status=r["friend_status"],
            error=r["error"],
        )
        try:
            gp_state.record_injection(**_record_kwargs)
        except KeyError:
            # 2026-11-07 (Arcade): an account already in god_pack_state.json from mark_power_used() has no
            # "god_pack_hits" list, so recording its God Pack crashed the worker ("worker exception:
            # 'god_pack_hits'") and the hit was lost from the run summary. Add the missing list and retry.
            try:
                _st = gp_state.load_state()
                _entry = _st.setdefault("accounts", {}).setdefault(r["account_key"], {})
                _entry.setdefault("god_pack_hits", [])
                _entry.setdefault("injections", 0)
                gp_state.save_state(_st)
                gp_state.record_injection(**_record_kwargs)
            except Exception as exc:
                log(f"[!] could not record this account in god_pack_state.json: {exc}", tag=r.get("account_key", ""))
        except Exception as exc:
            log(f"[!] could not record this account in god_pack_state.json: {exc}", tag=r.get("account_key", ""))
        if not args.dry_run:
            _bump_pack_count(acct, int(r.get("packs_opened") or 0))
        # Cooldown gate is `metadata.lastPackPulled` in each JSON, which the
        # PTCGPB-leannew bot updates when it opens packs. We do NOT touch
        # that field ourselves — record_injection() above only logs hits
        # and history to reports/god_pack_state.json for the pool report.
        # If leannew re-opens packs on this account within cooldown_hours
        # it will bump lastPackPulled and skip the account next run.
        return r

    # Parallel-safe consecutive-failure counter for auto-stop.
    # Only login_failed and PERMISSION_DENIED count as "proxy/tunnel is
    # burnt" failures. no_pack_power / ABORTED / accept_timeout do NOT
    # count (they indicate account state or collector behavior, not a
    # network problem worth stopping the whole run over).
    stop_after_fails = int(getattr(args, "stop_after_fails", 0) or 0)
    consec_fails = {"n": 0}
    consec_lock = threading.Lock()

    def _tally(r):
        nonlocal processed, packs_opened_total, god_hits, errors
        nonlocal accounts_no_packs, accounts_login_fail, accounts_aborted
        nonlocal accounts_proxy_dead, accounts_opened_at_least_one, cards_pulled_total
        processed += 1
        packs_opened_total += r["packs_opened"]
        cards_pulled_total += len(r.get("cards", []) or [])
        if r["packs_opened"] > 0:
            accounts_opened_at_least_one += 1
        else:
            accounts_no_packs += 1
        if r["god_pack"]:
            god_hits += 1
        err = str(r.get("error") or "")
        if err:
            errors += 1
            if "login_failed" in err:
                accounts_login_fail += 1
            elif "ABORTED" in err or "verify_power_zero" in err or "verify_power_partial" in err or "no_pack_power" in err:
                accounts_aborted += 1
            elif "PERMISSION_DENIED" in err or "<!doctype html" in err.lower():
                accounts_proxy_dead += 1

        # ---- Auto-stop tracker ---------------------------------------
        if stop_after_fails > 0:
            counted_failure = (
                "login_failed" in err
                or "PERMISSION_DENIED" in err
                or "<!doctype html" in err.lower()
            )
            with consec_lock:
                if counted_failure:
                    consec_fails["n"] += 1
                    n = consec_fails["n"]
                    log(f"[stop-tracker] consecutive failures: "
                        f"{n}/{stop_after_fails}")
                    if n >= stop_after_fails and not _stop_event.is_set():
                        log(f"[AUTO-STOP] hit {n} consecutive failures "
                            f"(login_failed / PERMISSION_DENIED). "
                            f"Setting stop event; the GUI window will hold.")
                        # Set the stop event so other workers stop picking
                        # up new accounts. Also touch --stop-file if the
                        # GUI passed one, so its watcher matches the state.
                        _stop_event.set()
                        sf = str(getattr(args, "stop_file", "") or "").strip()
                        if sf:
                            try:
                                Path(sf).parent.mkdir(parents=True, exist_ok=True)
                                Path(sf).write_text(
                                    f"auto-stop after {n} consecutive failures\n",
                                    encoding="utf-8")
                                log(f"[AUTO-STOP] wrote stop marker: {sf}")
                            except Exception as exc:
                                log(f"[AUTO-STOP] stop-file write failed: "
                                    f"{str(exc)[:150]}")
                else:
                    # Any qualifying success resets the counter.
                    if consec_fails["n"] > 0:
                        log(f"[stop-tracker] success -- counter reset "
                            f"(was {consec_fails['n']})")
                    consec_fails["n"] = 0

    try:
        if args.parallel <= 1:
            # Sequential — cleaner for manual accept flow
            for acct in accounts:
                if _stop_event.is_set():
                    break
                r = _worker(acct)
                if r is None:
                    continue
                _tally(r)
                # Adjustable between-accounts delay with ±20% jitter.
                ad = max(0.0, float(getattr(args, "account_delay", 2.0)))
                if ad > 0.0:
                    time.sleep(random.uniform(ad * 0.8, ad * 1.2))
        else:
            # Parallel — Fix 3 (2026-09-28): stagger submissions so the
            # `account_delay` GUI setting actually applies in parallel
            # mode too. The previous code submitted every account at
            # once with `{pool.submit(_worker, a): a for a in accounts}`
            # so N workers hit the tunnel simultaneously at start; then
            # each finished worker immediately kicked off the next with
            # zero gap. Combined with the proxy leak (see Fix 1) this
            # is how a batch of 55 accounts saturated the main IP in
            # minutes.
            #
            # Stagger interval = account_delay directly. Simpler and
            # matches the user's mental model ("5s between accounts" =
            # account_delay=5, regardless of parallel). Under the old
            # divide-by-parallel formula, account_delay=7 with
            # parallel=10 became a 0.7s stagger — which is almost the
            # 10-at-once launch that hammered the tunnel and got the
            # 2026-09-28 main-IP ban.
            #
            # At account_delay=0 there's no delay (opt-out — everything
            # goes back to submit-all-at-once behavior).
            ad_parallel = max(0.0, float(getattr(args, "account_delay", 2.0)))
            parallel_n = max(1, int(args.parallel))
            stagger = ad_parallel
            if stagger > 0:
                log(f"parallel stagger: {stagger:.1f}s between account "
                    f"submissions (account_delay={ad_parallel:.1f}s, "
                    f"parallel={parallel_n})")

            with ThreadPoolExecutor(max_workers=parallel_n) as pool:
                futures = {}
                for acct in accounts:
                    if _stop_event.is_set():
                        break
                    fut = pool.submit(_worker, acct)
                    futures[fut] = acct
                    if stagger > 0:
                        # ±20% jitter, same style as sequential mode.
                        time.sleep(random.uniform(stagger * 0.8,
                                                  stagger * 1.2))
                for fut in as_completed(futures):
                    if _stop_event.is_set():
                        break
                    try:
                        r = fut.result()
                    except Exception as exc:
                        errors += 1
                        log(f"[X] worker exception: {exc}")
                        continue
                    if r is None:
                        continue
                    _tally(r)
    finally:
        # FINAL SWEEP — runs no matter how the loop ended (Stop button,
        # auto-stop, exception). Every worker has returned by now, so any
        # account still in the ledger has leftover FRs/friendships.
        if not args.dry_run:
            log("=" * 70)
            sweep_fr_ledger("final cleanup before exit", scope="mine")

    duration = time.time() - started_at

    # Record run summary — include the total accounts the discover scan
    # saw so the pool report can compute 24h coverage against the full
    # pool (not just the eligible subset).
    gp_state.record_run_summary(
        accounts_processed=processed,
        accounts_skipped=0,  # already filtered before this fn
        packs_opened=packs_opened_total,
        god_packs_found=god_hits,
        errors=errors,
        duration_seconds=duration,
        accounts_discovered=int(_last_discovery_total or 0),
    )

    # Regenerate pool report
    gp_state.write_pool_report()

    # Patch the pool report to show WHICH pack this run was farming. The
    # report is a rolling markdown file that doesn't otherwise carry this
    # info — makes a difference when you switch packs between runs and
    # want to know what "Total accounts injected: 42" is counting.
    _annotate_pool_report_with_pack(args.pack_id)

    log("=" * 70)
    log(f"DONE — {processed} accounts processed in {duration:.1f}s "
        f"({duration/max(1,processed):.1f}s/account)")
    log(f"   • packs opened:        {packs_opened_total}")
    log(f"   • cards pulled:        {cards_pulled_total}")
    log(f"   • Wonder-Pick god hits:{god_hits}")
    log(f"   • accounts with ≥1 pack opened: {accounts_opened_at_least_one}")
    log(f"   • accounts with 0 packs opened: {accounts_no_packs}")
    if accounts_no_packs > 0:
        log(f"       ├─ login failed:      {accounts_login_fail}")
        log(f"       ├─ ABORTED (no power):{accounts_aborted}")
        log(f"       ├─ proxy dead (HTML): {accounts_proxy_dead}")
        other = accounts_no_packs - accounts_login_fail - accounts_aborted - accounts_proxy_dead
        log(f"       └─ other:             {other}")
    if accounts_aborted > 5 and accounts_aborted > accounts_opened_at_least_one:
        log(f"   ⚠ many ABORTED errors — leannew (or another tool) may be opening")
        log(f"     packs on these accounts and not updating metadata.lastPackPulled.")
        log(f"     Consider running with --verify-power to skip empty accounts before FR.")
    log(f"pool report: {gp_state.report_md_path()}")
    log("=" * 70)
    return 0 if errors == 0 else 1


def _install_signal_handlers():
    import signal
    def _handler(*_):
        log("[!] stop requested")
        _stop_event.set()
    try:
        signal.signal(signal.SIGINT, _handler)
        signal.signal(signal.SIGTERM, _handler)
    except Exception:
        pass


def _start_stop_file_watcher(stop_file_path: str):
    """
    Watch a marker file. When the GUI's Stop button is pressed, it creates
    this file; we notice and set _stop_event, which the between-account loop
    checks (line ~1837) to break out gracefully.

    This is the portable fallback for Windows, where QProcess.terminate()
    posts WM_CLOSE — not a signal — to the console-less Python subprocess,
    so SIGTERM handlers never fire. A polled marker file always works.

    Runs as a daemon thread that dies with the process. Polls every 0.5s,
    which is plenty responsive without burning CPU.
    """
    if not stop_file_path:
        return
    def _watch():
        p = pathlib.Path(stop_file_path)
        while not _stop_event.is_set():
            try:
                if p.exists():
                    log(f"[!] stop file detected: {stop_file_path} - "
                        f"will finish current account then exit")
                    _stop_event.set()
                    return
            except Exception:
                pass
            time.sleep(0.5)
    t = threading.Thread(target=_watch, name="stop-file-watcher", daemon=True)
    t.start()


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="God pack Wonder Pick injection over existing bot accounts.")
    p.add_argument("--worker-url", default="", help="Live ID Worker URL")
    p.add_argument("--collector-codes", default="",
                   help="One or more collector codes, comma/semicolon-separated. "
                        "Each entry is a 16-digit friend code (dashed or raw) or a UUID player_id.")
    p.add_argument("--packs", type=int, default=2, help="Packs to open per account (default: 2).")
    p.add_argument("--pack-id", default="BN010_0010_00_000",
                   help="Pack ID to open (default: B4a Team Rocket).")
    p.add_argument("--product-id", default="PC_PS_2608000_01_01_01",
                   help="Product ID matching pack-id.")
    p.add_argument("--gp-eligibility", default="", choices=["", "eligible", "locked"],
                   help="Only open GP-eligible accounts (God Pack mode) or only the locked ones (Open Packs Only). "
                        "Empty = all accounts.")
    p.add_argument("--power-id", default="",
                   help="Pack power pool ID (PACK_POWER_NORMAL or PACK_POWER_SPECIAL). Auto-detected if empty.")
    p.add_argument("--accounts-dir", default=str(PROJECT_ROOT / "accounts"),
                   help="Directory with TR_*.json + .xml pairs (fallback when "
                        "--xml-dir/--json-dir are not set).")
    p.add_argument("--xml-dir", default="",
                   help="Directory with XML credential files (searched recursively). "
                        "Overrides --accounts-dir for XMLs.")
    p.add_argument("--json-dir", default="",
                   help="Directory with matching JSON files. "
                        "Overrides --accounts-dir for JSONs. "
                        "Matched by shared basename or by {deviceAccount}.json.")
    p.add_argument("--proxy-file", default=str(PROJECT_ROOT / "proxies.txt"),
                   help="Proxy list, one per line.")
    p.add_argument("--proxy-scheme", default="http",
                   choices=["http", "https", "socks5"])
    p.add_argument("--proxy-revive-seconds", type=int, default=300,
                   help="Temporarily skip a proxy after failed post-login health "
                        "checks for this many seconds. 0 disables temporary skips.")
    p.add_argument("--proxy-checks", type=int, default=3,
                   help="Post-login pack-power health checks; 0 disables these checks.")
    p.add_argument("--proxy-check-gap", type=float, default=2.0,
                   help="Seconds between failed post-login health checks.")
    p.add_argument("--proxy-rotations", type=int, default=3,
                   help="Maximum proxies tried per account login.")
    p.add_argument("--cooldown-hours", type=float, default=24.0,
                   help="Skip accounts whose metadata.lastPackPulled is younger "
                        "than N hours. Missing/unparseable field = eligible.")
    p.add_argument("--wait-accept", type=float, default=7.0,
                   help="Seconds to wait after friend request for manual accept.")
    p.add_argument("--full-power-only", action="store_true",
                   help="With --verify-power (or godpack mode): skip accounts whose free packs are "
                        "not ALL recharged (e.g. 1 of 2). Used by the community GP farm.")
    p.add_argument("--verify-power", action="store_true",
                   help="Also call GetPackPowerV1 before sending FR (skips accounts "
                        "the server reports empty). Slower but stops wasting FRs when "
                        "leannew is racing us. Off by default — we trust "
                        "metadata.lastPackPulled.")
    p.add_argument("--log-file", default="",
                   help="Also tee all log output to this file (for the "
                        "PowerShell tail window). Empty = no file mirror.")
    p.add_argument("--stop-file", default="",
                   help="Marker file the GUI writes to request a graceful "
                        "stop. When this file appears, we finish the current "
                        "account (unfriend / register / cleanup) then exit "
                        "cleanly. Empty = no file watcher (Ctrl+C still works).")
    p.add_argument("--fr-per-min", type=float, default=58.0,
                   help="Cap friend-requests-sent per minute PER COLLECTOR "
                        "(each collector gets its own budget across all workers). "
                        "Total sends scale with collector count: 58/min × N. "
                        "Default 58 (matches observed cap). 0 disables throttle. "
                        "LEGACY: prefer --packs-per-min for a global cap.")
    p.add_argument("--max-collectors", type=int, default=0,   # Ale 2026-11-06: every online Main must get the GP
                   help="Max online (Worker) collectors per account, rotating between accounts. "
                        "The panel's own collector codes are always added on top. 0 = all.")
    p.add_argument("--packs-per-min", type=float, default=0.0,
                   help="PER-COLLECTOR ceiling on pack-opens per minute. Each "
                        "collector pid has its own 60s window; total throughput "
                        "= N collectors × ceiling. Shared across every inject.py "
                        "process on this machine (file-locked at "
                        "<project>/.pack_budget.json). Set once, run 15 GUI "
                        "instances — each collector stays under this number. "
                        "Reservations age out of the rolling window "
                        "automatically, no manual release needed on failures. "
                        "0 = disabled (default). Recommended: 55 (a few slots "
                        "below the observed 60/min per-collector cap).")
    p.add_argument("--shuffle-proxies", action="store_true", default=False,
                   help="Randomize the proxy pool order once at startup so every "
                        "restart hits IPs in a different sequence. Workers within "
                        "the run still share the same shuffled order, so accounts "
                        "stay in sync on which proxy comes next.")
    p.add_argument("--accept-timeout", type=float, default=0.0,
                   help="Max seconds to poll the friend list for accepted FRs "
                        "after sending. 0 (default) = disabled, fall back to the "
                        "fixed --wait-accept sleep. When > 0, packs are opened "
                        "as soon as ALL sent FRs are accepted; if the timeout "
                        "expires with pending FRs, they are cancelled and the "
                        "account is skipped.")
    p.add_argument("--stop-after-fails", type=int, default=0,
                   help="Auto-stop the run after N consecutive account failures "
                        "(login_failed or PERMISSION_DENIED). 0 (default) = "
                        "disabled. Counter is thread-safe across parallel workers; "
                        "any qualifying failure bumps it, any success resets it. "
                        "On trigger, --stop-file is written so the GUI holds state.")
    p.add_argument("--quarantine-locked", action="store_true", default=True,
                   help="On login exhaustion, classify the failure. If the "
                        "final error is a real auth block AFTER trying "
                        ">=2 different proxies, move the account files to "
                        "accounts/QUARANTINE/likely_banned/ and skip-list it. "
                        "Unknown failures go to accounts/QUARANTINE/unknown_failure/ "
                        "for review (not skip-listed). Default ON.")
    p.add_argument("--no-quarantine-locked", action="store_false",
                   dest="quarantine_locked",
                   help="Disable the locked-account quarantine feature; "
                        "failing accounts stay in place and retry next run.")
    p.add_argument("--skip-list", default="",
                   help="Path to the skip-list file. Empty = "
                        "reports/skip_accounts.txt. One device_account per line, "
                        "'#' comments allowed.")
    p.add_argument("--mode", choices=["godpack", "packs-only"], default="godpack",
                   help="godpack (default): FR + pack open + wishlist match. "
                        "packs-only: just open N packs, no FR, no unfriend logic.")
    p.add_argument("--send-likes", action="store_true",
                   help="After a successful pack open, send likes from only "
                        "the first five selected accounts. A persistent 24-hour "
                        "cycle prevents restart from initiating likes again.")
    p.add_argument("--like-codes-file", default="like_targets.txt",
                   help="Text file with the friend codes to LIKE (one per line, "
                        "'#' comments allowed). Separate from --collector-codes "
                        "(god-pack collectors). Relative paths resolve against "
                        "the project root. Read fresh for every account.")
    p.add_argument("--dismiss-popups", action=argparse.BooleanOptionalAction,
                   default=True,
                   help="Right after login, flip the 'welcome back' and "
                        "'60HG accomplished' popup flags true so PurchaseV2 "
                        "isn't gated on old accounts. Default ON. Safe: "
                        "no-op when the flags are already true.")
    p.add_argument("--min-hourglass", type=int, default=0,
                   help="Skip an account when it has fewer LARGE hourglasses "
                        "than this number. 0 disables the gate (default). "
                        "Paid packs cost 12/pack — set 120 for a clean 10-pack "
                        "run, 240 for two 10-packs, etc.")
    p.add_argument("--hg-cost", type=int, default=-1,
                   help="LARGE hourglasses to spend PER pack in PurchaseV2 "
                        "(placed in heal_items.chargers). -1 (default) means "
                        "auto-infer from pack_catalog by --pack-id: rocket=0, "
                        "paid packs=12. Pass an int to override — 0 forces "
                        "'free power only', 12 forces the paid-pack path.")
    p.add_argument("--farming-mode", choices=["only_gp", "gp_double", "gp_single"],
                   default="only_gp",
                   help="only_gp (default): keep only god packs meeting PP threshold. "
                        "gp_double: also keep normal packs containing 2x 2-star. "
                        "gp_single: also keep normal packs containing 1x or 2x 2-star "
                        "(superset of gp_double).")
    p.add_argument("--pack-power-min", choices=["1/5","2/5","3/5","4/5","5/5"],
                   default="1/5",
                   help="Minimum X/5 god pack tier to keep. 3/5 matches 3/5, 4/5, 5/5.")
    p.add_argument("--pack-delay", type=float, default=2.0,
                   help="Base seconds between pack opens on the same account. "
                        "Actual sleep is uniform(0.8x .. 1.2x) so 2.0 → 1.6-2.4s. "
                        "Bump this if the server throws rate-limit errors.")
    p.add_argument("--account-delay", type=float, default=2.0,
                   help="Base seconds between accounts (sequential mode). "
                        "Actual sleep is uniform(0.8x .. 1.2x). Ignored when "
                        "--parallel > 1.")
    p.add_argument("--parallel", type=int, default=1,
                   help="Concurrent accounts (1 = sequential, recommended for manual accept).")
    p.add_argument("--limit", type=int, default=0,
                   help="Max accounts to process this run (0 = all eligible).")
    p.add_argument("--sort-order", choices=["filename", "oldest", "newest"],
                   default="filename",
                   help="filename (default): alphabetical XML order. "
                        "oldest: process accounts whose lastPackPulled is oldest first "
                        "(never-pulled accounts come first). "
                        "newest: process accounts whose lastPackPulled is newest first "
                        "(cooldown is still respected — accounts under cooldown are "
                        "already filtered out before sorting).")
    p.add_argument("--cleanup-only", action="store_true",
                   help="Don't open anything: log into every account listed in "
                        "reports/fr_ledger.json, delete accepted + cancel pending "
                        "friend requests to collectors, then exit.")
    p.add_argument("--dry-run", action="store_true",
                   help="Log actions but don't send friend requests or open packs.")
    return p


def main() -> int:
    _install_signal_handlers()
    args = build_parser().parse_args()
    global _FULL_POWER_ONLY
    _FULL_POWER_ONLY = bool(getattr(args, "full_power_only", False))
    # Start file-based stop watcher only if --stop-file was provided.
    # The GUI passes one; running inject.py from a plain terminal doesn't
    # need it (Ctrl+C sends SIGINT which the signal handler catches).
    _start_stop_file_watcher(getattr(args, "stop_file", "") or "")
    try:
        return run_injection(args)
    except KeyboardInterrupt:
        log("[!] interrupted")
        return 130


if __name__ == "__main__":
    sys.exit(main())
