"""Respaldo por proxy para Fast Farm / Shinedust / Fast Share-Trade (Ale 2026-11-07).

Estos scripts entran a las cuentas con la IP del host que tiene el turno. Si el juego bloquea esa IP un
rato (PERMISSION_DENIED / pagina web en vez de respuesta), se reintenta la cuenta por 1 o 2 proxies de la
lista del host (la misma que usa el GP farm). No se insiste mas: muchos intentos hacen bloquear tambien
los proxies.
"""
import os
import random

MAX_PROXIES = 2


def ip_bloqueada(err) -> bool:
    s = str(err or "")
    return "PERMISSION_DENIED" in s or "403" in s or "<!doctype" in s.lower() or "<html" in s.lower()


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
    """Primero sin proxy (None = IP del host); despues hasta MAX_PROXIES proxies al azar."""
    return [None] + random.sample(proxies, min(MAX_PROXIES, len(proxies)))
