#!/usr/bin/env python3
import json
import time
import threading
import requests
import re
from pathlib import Path

# Configuración de rutas
ROOT = Path(__file__).resolve().parents[2]
POOL_REPORT = ROOT / "reports" / "god_pack_pool.md"
LIVE_LOG = ROOT / "reports" / "god_pack_live.log"
COMMUNITY_LOG = ROOT / "reports" / "reroll_comunidad.log"
CACHE_FILE = ROOT / "reports" / "ppm_session_cache.json"
SETTINGS_FILE = ROOT / "tools" / "god_pack_gui" / "settings.json"
COMMUNITY_FILE = ROOT / "reports" / "community_farm.json"

CACHE_TTL_SEC = 15 * 60  # 15 minutos de gracia después del último stop/actualización


def _load_gui_settings() -> dict:
    """Carga settings.json de la GUI para tener siempre los webhooks, host_name y workers reales."""
    if SETTINGS_FILE.is_file():
        try:
            return json.loads(SETTINGS_FILE.read_text("utf-8"))
        except Exception:
            pass
    return {}


def _load_valid_cache(now: float) -> dict:
    """
    Lee el caché si existe y si han pasado menos del TTL (15m)
    desde el último registro o parada. Si expiró, devuelve valores en 0.
    """
    if CACHE_FILE.is_file():
        try:
            data = json.loads(CACHE_FILE.read_text("utf-8"))
            last_active = float(data.get("last_active_ts", 0.0))
            if (now - last_active) <= CACHE_TTL_SEC:
                return {
                    "base_elapsed_sec": float(data.get("total_elapsed_sec", 0.0)),
                    "total_packs": int(data.get("total_packs", 0)),
                    "live_pos": int(data.get("live_pos", 0)),
                    "comm_pos": int(data.get("comm_pos", 0)),
                }
        except Exception:
            pass
    return {"base_elapsed_sec": 0.0, "total_packs": 0, "live_pos": 0, "comm_pos": 0}


def _save_cache(
    now: float,
    total_elapsed_sec: float,
    total_packs: int,
    active: bool = True,
    live_pos: int = 0,
    comm_pos: int = 0,
):
    """Guarda el progreso acumulado y las posiciones de lectura en disco."""
    try:
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "last_active_ts": now,
            "total_elapsed_sec": round(total_elapsed_sec, 2),
            "total_packs": int(total_packs),
            "active": active,
            "live_pos": int(live_pos),
            "comm_pos": int(comm_pos),
        }
        CACHE_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except Exception:
        pass


def touch_ppm_stop():
    """Marca el momento exacto en que se detuvo el reroll."""
    if CACHE_FILE.is_file():
        try:
            data = json.loads(CACHE_FILE.read_text("utf-8"))
            data["last_active_ts"] = time.time()
            data["active"] = False
            CACHE_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
        except Exception:
            pass


def _count_packs_in_chunk(chunk: str) -> int:
    """Cuenta los sobres abiertos dentro de un bloque de texto de log."""
    if not chunk:
        return 0
    opened = chunk.count("pack opened cards=")
    if opened > 0:
        return opened

    # Respaldo si el log usa líneas de verify_power o resumen
    verified_two = chunk.count("verify_power: server reports 2 pack")
    verified_one = chunk.count("verify_power: server reports 1 pack")
    if verified_two > 0 or verified_one > 0:
        return (verified_two * 2) + verified_one

    # Segundo respaldo por resúmenes de cuenta "-- ACCOUNT SUMMARY: ... packs=X"
    summary_packs = 0
    for m in re.finditer(r"-- ACCOUNT SUMMARY:.*?packs=(\d+)", chunk):
        try:
            summary_packs += int(m.group(1))
        except Exception:
            pass
    if summary_packs > 0:
        return summary_packs

    return 0


def _read_new_packs_from_file(log_path: Path, last_pos: int) -> tuple[int, int]:
    """Lee un archivo de log desde last_pos y devuelve (nuevos_packs, nueva_pos)."""
    if not log_path.is_file():
        return 0, 0
    try:
        size = log_path.stat().st_size
        if size < last_pos:
            # El archivo fue truncado o recreado al iniciar una nueva corrida
            last_pos = 0
        if size == last_pos:
            return 0, last_pos

        with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
            f.seek(last_pos)
            chunk = f.read()
            new_pos = f.tell()

        return _count_packs_in_chunk(chunk), new_pos
    except Exception:
        return 0, last_pos


def _get_new_packs_since(positions: dict[str, int]) -> tuple[int, dict[str, int]]:
    """
    Lee tanto el log propio (god_pack_live.log) como el log de Community Farm
    (reroll_comunidad.log) para no perder ni un solo sobre en ningún modo.
    """
    n_live, pos_live = _read_new_packs_from_file(LIVE_LOG, positions.get("live", 0))
    n_comm, pos_comm = _read_new_packs_from_file(COMMUNITY_LOG, positions.get("comm", 0))
    positions["live"] = pos_live
    positions["comm"] = pos_comm
    return (n_live + n_comm), positions


def get_headless_stats(
    run_start_time: float,
    base_elapsed_sec: float,
    current_packs: int,
    positions: dict[str, int] | None = None,
):
    """Calcula el tiempo total y promedio PPM y persiste el estado en caché."""
    now = time.time()
    current_run_sec = max(0.0, now - run_start_time)
    total_elapsed_sec = base_elapsed_sec + current_run_sec
    elapsed_min = max(0.1, total_elapsed_sec / 60.0)

    pos_live = positions.get("live", 0) if positions else 0
    pos_comm = positions.get("comm", 0) if positions else 0
    _save_cache(now, total_elapsed_sec, current_packs, active=True, live_pos=pos_live, comm_pos=pos_comm)

    avg_ppm = round(current_packs / elapsed_min, 2) if elapsed_min > 0 else 0.0
    return max(1, int(round(elapsed_min))), current_packs, avg_ppm


def _build_online_instances_line() -> str:
    """Construye la línea de instancias Online según el número de workers en settings.json."""
    cfg = _load_gui_settings()
    try:
        parallel = max(1, int(cfg.get("parallel", 10)))
    except Exception:
        parallel = 10
    workers_str = ", ".join(str(i) for i in range(1, parallel + 1))
    return f"Main, {workers_str}"


def send_discord_status(
    webhook_url: str,
    pack_name: str,
    run_start_time: float,
    base_elapsed_sec: float,
    current_packs: int,
    host_name: str,
    positions: dict[str, int] | None = None,
    log_fn=None,
):
    elapsed_m, packs, avg = get_headless_stats(
        run_start_time, base_elapsed_sec, current_packs, positions=positions
    )

    clean_pack_name = str(pack_name or "").strip()
    if "]" in clean_pack_name:
        clean_pack_name = clean_pack_name.split("]", 1)[-1].strip()
    if "—" in clean_pack_name:
        clean_pack_name = clean_pack_name.split("—")[0].strip()

    online_line = _build_online_instances_line()

    message = (
        f"{host_name}\n"
        f"Online: {online_line}\n"
        f"Offline: none\n"
        f"Time: {elapsed_m}m | Packs: {packs} | Avg: {avg} packs/min\n"
        f"Version: wrProxy\n"
        f"Type: Inject Wonderpick 96P+\n"
        f"Opening: {clean_pack_name}"
    )

    payload = {"content": message}
    try:
        resp = requests.post(webhook_url, json=payload, timeout=8)
        msg_ok = f"[ppm] Heartbeat sent to Discord -> Time: {elapsed_m}m | Packs: {packs} | Avg: {avg} PPM (HTTP {resp.status_code})"
        print(msg_ok, flush=True)
        if callable(log_fn):
            log_fn(msg_ok + "\n")
    except Exception as exc:
        err_msg = f"[!] Error sending PPM webhook: {exc}"
        print(err_msg, flush=True)
        if callable(log_fn):
            log_fn(err_msg + "\n")


def start_ppm_loop(
    webhook_url: str = "",
    pack_name: str = "",
    interval_minutes: int = 5,
    host_name: str = "Host",
    stop_event: threading.Event | None = None,
    log_fn=None,
):
    cfg = _load_gui_settings()
    webhook_url = (webhook_url or cfg.get("ppm_webhook") or "").strip()
    if not webhook_url:
        msg = "[ppm] No PPM Webhook URL configured; monitor disabled."
        print(msg, flush=True)
        if callable(log_fn):
            log_fn(msg + "\n")
        return

    host_name = (host_name or cfg.get("host_name") or "Host").strip()
    pack_name = (pack_name or cfg.get("pack_id") or "Deluxe Pack").strip()
    try:
        interval_minutes = max(1, int(interval_minutes or cfg.get("ppm_interval", 5)))
    except Exception:
        interval_minutes = 5

    now = time.time()
    cached = _load_valid_cache(now)
    base_elapsed_sec = cached["base_elapsed_sec"]
    total_packs = cached["total_packs"]

    # Si el log de comunidad ya existe de días anteriores y no venimos de caché reciente,
    # empezamos a leer desde el final actual para no sumar miles de sobres viejos.
    init_comm_pos = (
        cached["comm_pos"]
        if (base_elapsed_sec > 0 and cached["comm_pos"] > 0)
        else (COMMUNITY_LOG.stat().st_size if COMMUNITY_LOG.is_file() else 0)
    )
    init_live_pos = (
        cached["live_pos"]
        if (base_elapsed_sec > 0 and cached["live_pos"] > 0 and LIVE_LOG.is_file() and LIVE_LOG.stat().st_size >= cached["live_pos"])
        else 0
    )
    positions = {"live": init_live_pos, "comm": init_comm_pos}

    run_start_time = now
    if total_packs > 0 or base_elapsed_sec > 0:
        init_msg = (
            f"[*] Monitor PPM reanudado desde caché (<15m): "
            f"+{int(base_elapsed_sec // 60)}m acumulados, +{total_packs} packs previos."
        )
    else:
        init_msg = f"[*] Monitor PPM iniciado desde 0. Enviando cada {interval_minutes} minutos..."

    print(init_msg, flush=True)
    if callable(log_fn):
        log_fn(init_msg + "\n")

    wait_secs = max(10, int(interval_minutes * 60))

    while True:
        if stop_event is not None and stop_event.is_set():
            break

        # Esperar el intervalo en pasos cortos de 10s actualizando el conteo en vivo y el caché
        waited = 0.0
        step = 10.0
        while waited < wait_secs:
            if stop_event is not None and stop_event.wait(timeout=min(step, wait_secs - waited)):
                break
            if stop_event is None:
                time.sleep(min(step, wait_secs - waited))
            waited += step

            nuevos_packs, positions = _get_new_packs_since(positions)
            total_packs += nuevos_packs
            get_headless_stats(run_start_time, base_elapsed_sec, total_packs, positions=positions)

        if stop_event is not None and stop_event.is_set():
            break

        # Contar sobres justo antes de disparar el webhook a Discord
        nuevos_packs, positions = _get_new_packs_since(positions)
        total_packs += nuevos_packs

        send_discord_status(
            webhook_url,
            pack_name,
            run_start_time,
            base_elapsed_sec,
            total_packs,
            host_name,
            positions=positions,
            log_fn=log_fn,
        )

    nuevos_packs, positions = _get_new_packs_since(positions)
    total_packs += nuevos_packs
    get_headless_stats(run_start_time, base_elapsed_sec, total_packs, positions=positions)
    touch_ppm_stop()
    stop_msg = "[*] Monitor PPM detenido. Caché guardado por 15 minutos."
    print(stop_msg, flush=True)
    if callable(log_fn):
        log_fn(stop_msg + "\n")


if __name__ == "__main__":
    cfg = _load_gui_settings()
    WEBHOOK_UD = cfg.get("ppm_webhook") or ""
    PACK_SELECTION = cfg.get("pack_id") or "CN001_0010_00_000"
    HOST_NAME = cfg.get("host_name") or "Host"
    INTERVAL = int(cfg.get("ppm_interval") or 5)
    start_ppm_loop(WEBHOOK_UD, PACK_SELECTION, interval_minutes=INTERVAL, host_name=HOST_NAME)