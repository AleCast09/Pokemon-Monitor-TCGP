"""Respaldo por proxy para Fast Farm / Shinedust / Fast Share-Trade (Ale 2026-11-07).

Estos scripts entran a las cuentas por los proxies del host (desde 2026-11-24, antes con su IP). Si el juego bloquea esa IP un
rato (PERMISSION_DENIED / pagina web en vez de respuesta), se reintenta la cuenta por 1 o 2 proxies de la
lista del host (la misma que usa el GP farm). No se insiste mas: muchos intentos hacen bloquear tambien
los proxies.
"""
import os
import random

MAX_PROXIES = 2


def ip_bloqueada(err) -> bool:
    """IP bloqueada por el juego, o proxy que no responde: en los dos casos se prueba con el siguiente proxy."""
    s = str(err or "")
    return ("PERMISSION_DENIED" in s or "403" in s or "<!doctype" in s.lower() or "<html" in s.lower()
            or "UNAVAILABLE" in s or "DEADLINE_EXCEEDED" in s or "proxy" in s.lower() or "timed out" in s.lower())


def _a_url(linea: str) -> str:
    """user:pass@host:port, host:port@user:pass, host:port:user:pass o host:port -> http://user:pass@host:port"""
    p = linea.strip()
    if not p or p.startswith("#"):
        return ""
    if "://" in p:
        return p
    if "@" in p:
        izq, der = p.split("@", 1)
        # el lado con el puerto (numero al final) es el host
        if der.rsplit(":", 1)[-1].isdigit():
            return f"http://{izq}@{der}"
        return f"http://{der}@{izq}"
    partes = p.split(":")
    if len(partes) == 4:
        host, port, user, pw = partes
        return f"http://{user}:{pw}@{host}:{port}"
    return f"http://{p}"


def cargar(ruta: str) -> list:
    if not ruta or not os.path.isfile(ruta):
        return []
    try:
        with open(ruta, encoding="utf-8", errors="ignore") as f:
            return [u for u in (_a_url(l) for l in f) if u]
    except OSError:
        return []


def intentos(proxies: list) -> list:
    """(Ale 2026-11-24) SIEMPRE por proxy: hasta MAX_PROXIES + 1 proxies al azar, nunca la IP del host.
    Los comandos de los miembros (Shinedust "all go" con muchas cuentas, trades) salian por la IP de la casa
    del host del turno; el juego la frenaba y su MuMu daba "Error de autenticacion 102-002-007".
    Solo si el host no tiene ningun proxy se usa su IP (None)."""
    if not proxies:
        return [None]
    return random.sample(proxies, min(MAX_PROXIES + 1, len(proxies)))
