#!/usr/bin/env python3
"""Monitor Link Lite - Mac/Linux/Windows version of Monitor Link (Zenith Rise).

Para miembros que no usan Windows o no usan PTCGPB (2026-11-11, MysticWind en Mac con su propio bot).
Habla con el mismo servidor que Monitor Link.ahk (monitor-link-server.js), solo con la libreria estandar
de Python 3.8+. Hace lo esencial:
  - vincular con la clave de /link (ML2-...)
  - ping cada minuto (direccion nueva del bot desde la libreta si cambia)
  - prestar cuentas al GP farm (lista + XML a pedido, solo las prestadas)
  - anotar los sobres que abrieron los hosts (historial propio para la regla de 96 sobres)
  - compartir proxies, amigos y Main ID (opcional)
Las cuentas nunca se guardan en ningun host: el XML se arma en memoria cuando un host la pide.

Run:  python3 monitor_link_lite.py           (first time asks the setup questions)
      python3 monitor_link_lite.py --setup   (change the settings)
"""
import base64
import datetime as dt
import hashlib
import json
import os
import re
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from xml.sax.saxutils import escape

VERSION = "lite-1.0"
HOME = Path(os.environ.get("MONITOR_LINK_LITE_HOME") or (Path.home() / ".monitor_link_lite"))
CONFIG = HOME / "config.json"
STATE = HOME / "state.json"          # sobres que abrieron los hosts, por cuenta
LOG = HOME / "reroll_log.txt"

# ---------------------------------------------------------------- HTTP
_ctx = ssl.create_default_context()
for _pem in ("/etc/ssl/cert.pem", "/usr/local/etc/openssl/cert.pem", "/opt/homebrew/etc/openssl@3/cert.pem"):
    if os.path.exists(_pem):
        try:
            _ctx.load_verify_locations(_pem)   # Python de python.org en Mac no trae certificados
        except Exception:
            pass
try:
    import certifi  # opcional
    _ctx.load_verify_locations(certifi.where())
except Exception:
    pass


def http(method, url, body=None, token=None, timeout=30, ctype="text/plain; charset=utf-8"):
    """Devuelve (status, texto). Errores de red -> excepcion."""
    data = None if body is None else (body if isinstance(body, bytes) else body.encode("utf-8"))
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("User-Agent", f"MonitorLinkLite/{VERSION}")
    if data is not None:
        req.add_header("Content-Type", ctype)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_ctx) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def jloads(t, default=None):
    try:
        return json.loads(t)
    except Exception:
        return default


def now():
    return dt.datetime.now().strftime("%H:%M:%S")


def say(msg):
    print(f"[{now()}] {msg}", flush=True)


def load_json(path, default):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return default


def save_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    os.replace(tmp, path)


# ---------------------------------------------------------------- accounts
# Cada cuenta: { f: "nombre.xml", account, password, packs (o None), last "YYYYMMDDHHMMSS" (o "") }.
ACC_KEYS = ("deviceAccount", "device_account", "deviceaccount", "account", "account_id", "accountId")
PASS_KEYS = ("devicePassword", "device_password", "devicepassword", "password", "account_password")
SAFE_NAME = re.compile(r'^[^\\/:*?"<>|]{1,120}\.xml$', re.I)


def _find_key(obj, keys, depth=0):
    """Busca la primera clave (sin importar mayusculas) en un JSON anidado."""
    if depth > 4:
        return None
    if isinstance(obj, dict):
        low = {str(k).lower(): v for k, v in obj.items()}
        for k in keys:
            v = low.get(k.lower())
            if isinstance(v, (str, int)) and str(v).strip():
                return str(v).strip()
        for v in obj.values():
            r = _find_key(v, keys, depth + 1)
            if r:
                return r
    elif isinstance(obj, list):
        for v in obj[:50]:
            r = _find_key(v, keys, depth + 1)
            if r:
                return r
    return None


def _int_key(obj, key):
    v = _find_key(obj, (key,))
    try:
        return int(v)
    except Exception:
        return None


def _xml_name(stem):
    name = re.sub(r'[\\/:*?"<>|]', "_", stem).strip()[:116] or "account"
    return name if name.lower().endswith(".xml") else name + ".xml"


DB_EXT = (".db", ".sqlite", ".sqlite3")


def _col(cols, wanted, override=None):
    if override:
        return override if override in cols else None
    low = {c.lower(): c for c in cols}
    for w in wanted:
        if w.lower() in low:
            return low[w.lower()]
    return None


def read_sqlite(path, cfg):
    """Cuentas de una base SQLite (bots headless). Busca sola la tabla con columnas de cuenta y clave;
    se puede forzar con sqlite_table / sqlite_account_col / sqlite_password_col en config.json."""
    import sqlite3
    out = []
    try:
        con = sqlite3.connect(f"file:{Path(path).as_posix()}?mode=ro", uri=True, timeout=10)
    except Exception:
        return out
    try:
        tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        if cfg.get("sqlite_table"):
            tables = [t for t in tables if t == cfg["sqlite_table"]]
        for tb in tables:
            cols = [r[1] for r in con.execute(f'PRAGMA table_info("{tb}")')]
            ca = _col(cols, ACC_KEYS, cfg.get("sqlite_account_col"))
            cp = _col(cols, PASS_KEYS, cfg.get("sqlite_password_col"))
            if not ca or not cp:
                continue
            cn = _col(cols, ("name", "nickname", "username", "filename", "file_name", "label"), cfg.get("sqlite_name_col"))
            cc = _col(cols, ("packCount", "pack_count", "packs", "packs_opened", "total_packs"), cfg.get("sqlite_packs_col"))
            cl = _col(cols, ("lastPackPulled", "last_pack_pulled", "last_pack", "last_opened"), cfg.get("sqlite_last_col"))
            sel = [ca, cp] + [c for c in (cn, cc, cl) if c]
            q = "SELECT " + ", ".join(f'"{c}"' for c in sel) + f' FROM "{tb}"'
            for row in con.execute(q):
                r = dict(zip(sel, row))
                acc, pw = str(r[ca] or "").strip(), str(r[cp] or "").strip()
                if not acc or not pw:
                    continue
                packs = None
                if cc:
                    try:
                        packs = int(r[cc])
                    except Exception:
                        packs = None
                last = re.sub(r"\D", "", str(r[cl] or ""))[:14] if cl else ""
                stem = str(r[cn]).strip() if cn and r[cn] else f"{tb}_{hashlib.sha1(acc.encode()).hexdigest()[:10]}"
                out.append((stem, acc, pw, packs, last))
            if out:
                break
    except Exception as e:
        say(f"Could not read the database {path}: {e}")
    finally:
        con.close()
    return out


def read_accounts(folder, cfg):
    """Todas las cuentas: XML de PTCGPB, JSON de otros bots o una base SQLite (archivo o dentro de la carpeta)."""
    out, seen = {}, set()
    folder = Path(folder).expanduser()
    dbs = [folder] if folder.is_file() and folder.suffix.lower() in DB_EXT else (
        sorted(p for p in folder.rglob("*") if p.suffix.lower() in DB_EXT) if folder.is_dir() else [])
    for db in dbs:
        for stem, acc, pw, packs, last in read_sqlite(db, cfg):
            name = _xml_name(stem)
            if name.lower() in seen:
                name = _xml_name(f"{stem}_{hashlib.sha1(acc.encode()).hexdigest()[:6]}")
            seen.add(name.lower())
            out[name] = {"f": name, "account": acc, "password": pw, "packs": packs,
                         "last": last if len(last) == 14 else "", "path": str(db)}
    if not folder.is_dir():
        return out
    acc_key = cfg.get("json_account_key") or None
    pass_key = cfg.get("json_password_key") or None
    for p in sorted(folder.rglob("*")):
        if not p.is_file() or p.stat().st_size > 2_000_000:
            continue
        ext = p.suffix.lower()
        acc = pw = None
        packs, last = None, ""
        if ext == ".xml":
            t = p.read_text(encoding="utf-8", errors="replace")
            ma = re.search(r'name="deviceAccount"\s*>([^<]*)<', t)
            mp = re.search(r'name="devicePassword"\s*>([^<]*)<', t)
            if ma and mp:
                acc, pw = ma.group(1).strip(), mp.group(1).strip()
            # PTCGPB guarda el JSON de cartas aparte: si existe al lado, de ahi salen los sobres.
            side = p.with_suffix(".json")
            if side.exists():
                j = load_json(side, {})
                packs, last = _int_key(j, "packCount"), str(_find_key(j, ("lastPackPulled",)) or "")
        elif ext == ".json":
            j = load_json(p, None)
            if j is None:
                continue
            acc = _find_key(j, (acc_key,) if acc_key else ACC_KEYS)
            pw = _find_key(j, (pass_key,) if pass_key else PASS_KEYS)
            packs, last = _int_key(j, "packCount"), str(_find_key(j, ("lastPackPulled",)) or "")
        else:
            continue
        if not acc or not pw:
            continue
        name = _xml_name(p.stem)
        if name.lower() in seen:   # mismo nombre en dos carpetas: se le agrega un pedacito del id
            name = _xml_name(f"{p.stem}_{hashlib.sha1(acc.encode()).hexdigest()[:6]}")
        seen.add(name.lower())
        out[name] = {"f": name, "account": acc, "password": pw, "packs": packs,
                     "last": last if re.fullmatch(r"\d{14}", last or "") else "", "path": str(p)}
    return out


def account_xml(a):
    return ("<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n"
            f'    <string name="deviceAccount">{escape(a["account"])}</string>\n'
            f'    <string name="devicePassword">{escape(a["password"])}</string>\n</map>\n')


def packs_missing(total, pulls):
    """Misma regla que Monitor Link (SobresFaltanGP) y inject.py (_gp_packs_missing). 0 = elegible."""
    if total is not None and 0 <= total < 96:
        return 96 - total
    days = {}
    for ts in pulls:
        try:
            d = dt.date.fromisoformat(str(ts)[:10])
        except Exception:
            continue
        days[d] = days.get(d, 0) + 1
    if not days:
        return 0
    gap, packs, prev = False, 0, None
    for d in sorted(days):
        if prev is not None and (d - prev).days >= 30:
            gap, packs = True, 0
        packs += days[d]
        prev = d
    if (dt.date.today() - prev).days >= 30:
        return 96
    if not gap:
        return 0
    return 0 if packs >= 96 else 96 - packs


# ---------------------------------------------------------------- the link
class Link:
    def __init__(self, cfg):
        self.cfg = cfg
        self.state = load_json(STATE, {"accounts": {}, "applied": []})
        self.lock = threading.Lock()
        self.accounts = {}
        self.acc_print = None
        self.mirrors = []
        self.online = False
        self.lib_last = 0
        self.proxy_print = None
        self.job_threads = {}
        self.stop = False

    # -- helpers
    @property
    def server(self):
        return self.cfg["server"].rstrip("/")

    def servers(self):
        return [self.server] + [m for m in self.mirrors if m != self.server]

    def post_all(self, path, body, timeout=60):
        """Al host del turno y a los demas (cada host tiene la lista completa). Devuelve el status del principal."""
        st = None
        for i, srv in enumerate(self.servers()):
            try:
                s, t = http("POST", srv + path, body, self.cfg["token"], timeout)
                if i == 0:
                    st = s
                    if s == 401:
                        self.not_linked()
            except Exception:
                pass
        return st

    def not_linked(self):
        say("This Monitor Link is not linked anymore. Run it with --setup and paste a new /link key.")
        self.stop = True

    def save_state(self):
        with self.lock:
            save_json(STATE, self.state)

    def shared(self):
        if self.cfg.get("share_all", True):
            return set(self.accounts)
        return set(self.cfg.get("share_list") or []) & set(self.accounts)

    # -- address book: the bot's public address changes when it restarts
    def no_connection(self):
        self.online = False
        lib = self.cfg.get("lib") or {}
        if not lib.get("u") or not lib.get("t") or time.time() - self.lib_last < 120:
            return
        self.lib_last = time.time()
        try:
            s, t = http("GET", lib["u"].rstrip("/") + "/get/monitor_link:url", token=lib["t"], timeout=15)
            url = str((jloads(t, {}) or {}).get("result") or "").rstrip("/")
            if s == 200 and url.startswith("https://") and url != self.server:
                self.cfg["server"] = url
                save_json(CONFIG, self.cfg)
                say(f"The bot moved to a new address, reconnecting.")
                self.send_everything()
        except Exception:
            pass

    # -- ping every minute
    def ping(self):
        try:
            s, t = http("GET", self.server + "/link/ping", token=self.cfg["token"], timeout=20)
        except Exception:
            return self.no_connection()
        if s == 401:
            return self.not_linked()
        if s != 200:
            return self.no_connection()
        d = jloads(t, {}) or {}
        if not self.online:
            self.online = True
            say(f"Online as {d.get('user') or '?'}.")
        lib = d.get("lib")
        if isinstance(lib, dict) and lib.get("u") and lib != self.cfg.get("lib"):
            self.cfg["lib"] = {"u": lib["u"], "t": lib.get("t", "")}
            save_json(CONFIG, self.cfg)
        mirrors = sorted({str(m).rstrip("/") for m in d.get("mirrors") or [] if str(m).startswith("https://")})
        if mirrors != self.mirrors:
            self.mirrors = mirrors
            self.send_everything()
        banned = d.get("banned") or []
        if banned and banned != getattr(self, "_banned", None):
            self._banned = banned
            say(f"Hosts marked {len(banned)} account(s) as 'Banned?': {', '.join(banned[:10])}")

    def send_everything(self):
        self.send_accounts(force=True)
        self.send_proxies(force=True)
        if self.cfg.get("friends"):
            self.post_all("/link/friends", json.dumps({"ids": self.cfg["friends"]}), 30)
        if self.cfg.get("main_id"):
            self.post_all("/link/main", json.dumps({"main": self.cfg["main_id"]}), 30)

    # -- accounts for the GP farm
    def scan(self):
        self.accounts = read_accounts(self.cfg["accounts_folder"], self.cfg)

    def account_entry(self, a):
        st = self.state["accounts"].get(a["f"], {})
        pulls = st.get("pulls", [])
        base = a["packs"] if a["packs"] is not None else st.get("base", 0)
        total = base + len(pulls) if a["packs"] is None else max(a["packs"], base + len(pulls))
        last = max(a["last"] or "", st.get("last", "") or "")
        return {"f": a["f"], "p": int(total), "l": last, "e": packs_missing(total, pulls)}, total

    def send_accounts(self, force=False):
        self.scan()
        if not self.cfg.get("share_accounts", True):
            body = json.dumps({"accounts": []})
        else:
            items, n96, ok, lock = [], 0, 0, 0
            shared = self.shared()
            for name, a in sorted(self.accounts.items()):
                entry, total = self.account_entry(a)
                if total >= 96:
                    n96 += 1
                    if entry["e"]:
                        lock += 1
                    else:
                        ok += 1
                if name in shared:
                    items.append(entry)
            body = json.dumps({"accounts": items, "stats": {"n96": n96, "ok": ok, "lock": lock}})
        fp = hashlib.sha1(body.encode()).hexdigest()
        if not force and fp == self.acc_print:
            return
        st = self.post_all("/link/reroll-accounts", body, 60)
        if st == 200:
            self.acc_print = fp
            data = json.loads(body)
            elig = sum(1 for c in data["accounts"] if c["e"] == 0)
            say(f"Sharing {len(data['accounts'])} account(s) with the GP farm "
                f"({elig} God Pack eligible, {len(data['accounts']) - elig} still opening packs to 96).")

    # -- proxies
    def send_proxies(self, force=False):
        pf = (self.cfg.get("proxy_file") or "").strip()
        if not pf:
            return
        p = Path(pf).expanduser()
        if not p.exists():
            say(f"Proxy file not found: {p}")
            return
        txt = p.read_text(encoding="utf-8", errors="replace")
        fp = hashlib.sha1(txt.encode()).hexdigest()
        if not force and fp == self.proxy_print:
            return
        if self.post_all("/link/proxies", txt, 60) == 200:
            self.proxy_print = fp
            n = sum(1 for l in txt.splitlines() if l.strip() and not l.strip().startswith("#"))
            say(f"Shared {n} prox{'y' if n == 1 else 'ies'} with the community.")

    # -- jobs (one long request per host)
    def job_loop(self, srv):
        while not self.stop and srv in self.servers():
            try:
                s, t = http("GET", srv + "/link/jobs", token=self.cfg["token"], timeout=40)
            except Exception:
                time.sleep(5 if srv == self.server else 15)
                continue
            if s == 401 and srv == self.server:
                return self.not_linked()
            if s != 200:
                time.sleep(5 if srv == self.server else 30)
                continue
            for job in (jloads(t, {}) or {}).get("jobs") or []:
                try:
                    self.do_job(srv, job)
                except Exception as e:
                    say(f"Could not answer a request from a host: {e}")
        self.job_threads.pop(srv, None)

    def keep_job_threads(self):
        for srv in self.servers():
            th = self.job_threads.get(srv)
            if not th or not th.is_alive():
                th = threading.Thread(target=self.job_loop, args=(srv,), daemon=True)
                self.job_threads[srv] = th
                th.start()

    def answer(self, srv, data):
        http("POST", srv + "/link/xml", json.dumps(data), self.cfg["token"], 60)

    def do_job(self, srv, job):
        jid, action = job.get("id"), job.get("action")
        if not jid:
            return
        if action is None and isinstance(job.get("files"), list):
            # Discord (Fast Share/Trade, Extract XML): the member asked for their own account.
            self.scan()
            files, missing = {}, []
            for n in job["files"]:
                a = self.accounts.get(_xml_name(str(n)))
                if a:
                    files[str(n)] = account_xml(a)
                else:
                    missing.append(str(n))
            self.answer(srv, {"id": jid, "files": files, "missing": missing})
            say(f"Sent {len(files)} account file(s) you asked for in Discord.")
        elif action == "reroll_xml":
            # A host is about to open shared accounts: send ONLY the shared ones.
            self.scan()
            shared = self.shared() if self.cfg.get("share_accounts", True) else set()
            files, missing = {}, []
            for n in job.get("files") or []:
                n = str(n)
                if n in shared:
                    files[n] = account_xml(self.accounts[n])
                else:
                    missing.append(n)
            self.answer(srv, {"id": jid, "files": files, "missing": missing})
            with open(LOG, "a", encoding="utf-8") as f:
                f.write(f"{dt.datetime.now():%Y-%m-%d %H:%M}  host opened {len(files)} account(s) for reroll: "
                        f"{' '.join(files)}{f'  (refused {len(missing)})' if missing else ''}\n")
            say(f"A host is opening {len(files)} of your account(s).")
        elif action == "add_pulls":
            self.add_pulls(srv, jid, str(job.get("file") or ""), str(job.get("content") or ""))
        else:
            # Things only the Windows version can do (MuMu, PTCGPB card files, wishlist).
            self.answer(srv, {"id": jid, "ok": False, "error": "not supported on Monitor Link Lite"})

    def add_pulls(self, srv, jid, name, content):
        try:
            d = json.loads(base64.b64decode(content).decode("utf-8"))
        except Exception:
            return self.answer(srv, {"id": jid, "ok": False, "error": "bad content"})
        key = str(d.get("key") or "")
        if not key:
            return self.answer(srv, {"id": jid, "ok": False, "error": "bad content"})
        with self.lock:
            if key in self.state["applied"]:
                done = True
            else:
                done = False
                name = _xml_name(re.sub(r"(?i)\.xml$", "", name))
                st = self.state["accounts"].setdefault(name, {"pulls": [], "last": ""})
                if "base" not in st:
                    a = self.accounts.get(name)
                    st["base"] = (a or {}).get("packs") or 0
                pulls = d.get("pulls") or []
                st["pulls"] = (st["pulls"] + [str(p.get("timestamp", "")) for p in pulls if isinstance(p, dict)])[-2000:]
                if re.fullmatch(r"\d{14}", str(d.get("last") or "")):
                    st["last"] = str(d["last"])
                self.state["applied"] = (self.state["applied"] + [key])[-5000:]
        if done:
            return self.answer(srv, {"id": jid, "ok": True, "already": True})
        self.save_state()
        self.answer(srv, {"id": jid, "ok": True})
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(f"{dt.datetime.now():%Y-%m-%d %H:%M}  {len(d.get('pulls') or [])} pack(s) opened by the host on {name}\n")
        say(f"A host opened {len(d.get('pulls') or [])} pack(s) on {name}.")
        self.send_accounts()

    # -- main loop
    def run(self):
        say(f"Monitor Link Lite {VERSION} - accounts folder: {self.cfg['accounts_folder']}")
        self.scan()
        say(f"Found {len(self.accounts)} account(s) in the folder.")
        self.ping()
        self.send_everything()
        last_ping = last_scan = time.time()
        while not self.stop:
            self.keep_job_threads()
            time.sleep(2)
            if time.time() - last_ping >= 60:
                last_ping = time.time()
                self.ping()
                self.send_proxies()
            if time.time() - last_scan >= 300:
                last_scan = time.time()
                self.send_accounts()
        return 1


# ---------------------------------------------------------------- setup
def ask(q, default=""):
    a = input(f"{q}{f' [{default}]' if default else ''}: ").strip()
    return a or default


def claim(key):
    m = re.fullmatch(r"ML([12])-([A-Za-z0-9_-]+)", key.strip())
    if not m:
        raise SystemExit("That doesn't look like a link key (it starts with ML2-). Type /link in Zenith Rise.")
    raw = m.group(2) + "=" * (-len(m.group(2)) % 4)
    parts = base64.urlsafe_b64decode(raw).decode("utf-8").split("|")
    if len(parts) < 2:
        raise SystemExit("That key is damaged. Type /link again for a new one.")
    url, body = parts[0].rstrip("/"), json.dumps({"code": parts[1], "version": VERSION})
    lib = {"u": parts[2], "t": parts[3]} if len(parts) >= 4 else None
    try:
        s, t = http("POST", url + "/link/claim", body, ctype="application/json; charset=utf-8")
    except Exception:
        s, t = 0, ""
    if (s == 0 or s >= 500 or (s == 404 and "invalid_or_expired_code" not in t)) and lib:
        # La direccion de la clave ya no existe: la actual esta en la libreta.
        try:
            _, lt = http("GET", lib["u"].rstrip("/") + "/get/monitor_link:url", token=lib["t"], timeout=15)
            nueva = str((jloads(lt, {}) or {}).get("result") or "").rstrip("/")
            if nueva and nueva != url:
                url = nueva
                s, t = http("POST", url + "/link/claim", body, ctype="application/json; charset=utf-8")
        except Exception:
            pass
    if s != 200:
        if "invalid_or_expired_code" in t:
            raise SystemExit("That key is invalid or expired (it lasts 10 minutes and works once). Type /link again.")
        raise SystemExit(f"Could not link ({s or 'no connection'}). Is the bot online? Try again.")
    d = json.loads(t)
    return {"server": url, "token": d["token"], "user": d.get("user"), "lib": lib}


def setup(cfg):
    print("\n=== Monitor Link Lite setup ===  (press Enter to keep the value in [brackets])\n")
    if not cfg.get("token") or ask("Link again with a new /link key? (y/n)", "n").lower().startswith("y"):
        key = ask("1) Paste your link key (type /link in Zenith Rise)")
        cfg.update(claim(key))
        print(f"   Linked as {cfg.get('user')}.\n")
    while True:
        folder = ask("2) Folder (or SQLite .db file) where your bot saves the accounts", cfg.get("accounts_folder", ""))
        found = read_accounts(folder, cfg)
        if found:
            print(f"   Found {len(found)} account(s).\n")
            break
        print("   No accounts found there (looking for .xml / .json / SQLite .db with deviceAccount + devicePassword).")
        if ask("   Use this folder anyway? (y/n)", "n").lower().startswith("y"):
            break
    cfg["accounts_folder"] = folder
    cfg["share_accounts"] = ask("3) Lend your accounts to the community GP farm? (y/n)",
                                "y" if cfg.get("share_accounts", True) else "n").lower().startswith("y")
    cfg["share_all"] = True
    cfg["proxy_file"] = ask("4) Proxy list file to share (optional, Enter to skip)", cfg.get("proxy_file", ""))
    main = re.sub(r"\D", "", ask("5) Your Main friend ID, 16 digits (optional)", cfg.get("main_id", "")))
    cfg["main_id"] = main if len(main) == 16 else ""
    HOME.mkdir(parents=True, exist_ok=True)
    save_json(CONFIG, cfg)
    print(f"\nSaved in {CONFIG}\n")
    return cfg


def main():
    cfg = load_json(CONFIG, {})
    if "--setup" in sys.argv or not cfg.get("token") or not cfg.get("accounts_folder"):
        cfg = setup(cfg)
    try:
        return Link(cfg).run()
    except KeyboardInterrupt:
        say("Stopped. Your accounts are no longer reachable by the hosts until you open it again.")
        return 0


if __name__ == "__main__":
    sys.exit(main())
