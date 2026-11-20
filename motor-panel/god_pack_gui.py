#!/usr/bin/env python3
"""
God Pack Injection GUI — standalone PyQt5 dashboard (Modern Tabbed Edition).

Spawns scripts/god_pack/inject.py with the configured parameters.
Streams live color-coded output in English and captures real-time God Pack hits & critical errors.
"""
from __future__ import annotations
import html as _html
import json, os, re, sys, time, uuid
from pathlib import Path

from PyQt5.QtCore import Qt, QTimer, QProcess, QProcessEnvironment, QUrl
from PyQt5.QtGui import QColor, QFont, QIcon, QPixmap, QPainter, QTextCursor, QDesktopServices
from PyQt5.QtWidgets import (
    QApplication, QMainWindow, QWidget, QLabel, QLineEdit, QComboBox,
    QSpinBox, QDoubleSpinBox, QCheckBox, QPushButton, QTextEdit, QScrollArea,
    QVBoxLayout, QHBoxLayout, QGridLayout, QFrame, QSizePolicy, QMessageBox,
    QListWidget, QListWidgetItem, QAbstractItemView, QSplitter, QFileDialog,
    QTabWidget, QDialog,
)

# ═══════ PATHS ═══════
ROOT = Path(__file__).resolve().parents[2]
INJECT_SCRIPT = ROOT / "scripts" / "god_pack" / "inject.py"
LOGO = ROOT / "statics" / "logo.png"
SETTINGS_FILE = ROOT / "tools" / "god_pack_gui" / "settings.json"
POOL_REPORT = ROOT / "reports" / "god_pack_pool.md"
STATE_FILE = ROOT / "reports" / "god_pack_state.json"

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Try to import the pack catalog for the pack dropdown.
try:
    from scripts.flow.pack_catalog import (
        paid_pack_options, product_id_for_pack, DEFAULT_PAID_PACK_ID
    )
    _PACK_CATALOG_OK = True
except Exception:
    _PACK_CATALOG_OK = False
    DEFAULT_PAID_PACK_ID = "BN010_0010_00_000"

    def paid_pack_options():
        return [
            {"pack_id": "BN008_0010_00_000", "sku_id": "B4a_1",
             "name": "Team Rocket's Ambition"},
            {"pack_id": "CN001_0010_00_000", "sku_id": "C1_1",
             "name": "Dual Fusion Mega Mewtwo X"},
            {"pack_id": "CN001_0020_00_000", "sku_id": "C1_2",
             "name": "Dual Fusion Pikachu"},
        ]

    def product_id_for_pack(pack_id):
        mapping = {
            "BN010_0010_00_000": "PC_PS_2608000_01_01_01",
            "BN001_0030_00_000": "PC_PS_2510000_01_03_01",
            "BN011_0010_00_000": "PC_PS_2609000_01_01_01",
        }
        return mapping.get(pack_id, "PC_PS_2608000_01_01_01")


_EXTRA_PACKS = [
    {"pack_id": "BN011_0010_00_000", "sku_id": "B4b_1", "name": "Deluxe Mega",
     "product_id": "PC_PS_2609000_01_01_01"},
    # 2026-11-07 (Ale, from wr98): special pack, own energy (PACK_POWER_SPECIAL), 1 pack per account.
    {"pack_id": "SP001_0010_00_000", "sku_id": "SP1_1", "name": "Special Pack: First Partners",
     "product_id": "PC_PS_2610010_01_01_01"},
]


def packs_for(pack_id, wanted):
    """Special packs (SP...) open 1 per account: they use their own energy, not the normal 2-pack power."""
    return 1 if str(pack_id or "").upper().startswith("SP") else wanted

_catalog_paid_pack_options = paid_pack_options
_catalog_product_id_for_pack = product_id_for_pack


def paid_pack_options():
    opts = list(_catalog_paid_pack_options())
    known = {o.get("pack_id") for o in opts}
    for extra in _EXTRA_PACKS:
        if extra["pack_id"] not in known:
            opts.append({k: v for k, v in extra.items() if k != "product_id"})
    return opts


def product_id_for_pack(pack_id):
    known = {o.get("pack_id") for o in _catalog_paid_pack_options()}
    if pack_id not in known:
        for extra in _EXTRA_PACKS:
            if extra["pack_id"] == pack_id:
                return extra["product_id"]
    return _catalog_product_id_for_pack(pack_id)


# ═══════ THEME (CYBERPUNK MIDNIGHT PALETTE) ═══════
D = {
    "BG":       "#080c1d",   # Deepest background
    "PANEL":    "#10162f",   # Main container surface
    "CARD":     "#161e3d",   # Sub-card surface
    "INPUT":    "#0d1329",   # Input fields
    "INPUT_HI": "#1b254b",   # Input hover
    "BORDER":   "#232d56",   # Subtle borders
    "BORDER2":  "#3b4880",   # Highlight borders
    "ACCENT":   "#a78bfa",   # Violet primary
    "ACCENT2":  "#7c3aed",   # Violet deep
    "PINK":     "#f472b6",   # Pink secondary
    "PINK2":    "#db2777",   # Pink deep
    "CYAN":     "#38bdf8",   # Cyan highlights
    "GREEN":    "#4ade80",   # Success / Running
    "AMBER":    "#fbbf24",   # Warning / Stopping
    "RED":      "#f87171",   # Danger / Stop
    "GOLD":     "#fde047",   # God Pack Gold
    "TEXT":     "#f1f5f9",   # Primary bright text
    "TEXT2":    "#94a3b8",   # Secondary label text
    "TEXT3":    "#64748b",   # Muted hints
}

STYLESHEET = f"""
QMainWindow, QWidget {{
    background: {D['BG']};
    color: {D['TEXT']};
    font-family: 'Segoe UI', 'Inter', sans-serif;
    font-size: 12px;
}}
QLabel {{ color: {D['TEXT2']}; background: transparent; }}

/* ─── Cards & Containers ─── */
QFrame#mainPanel {{
    background: {D['PANEL']};
    border: 1px solid {D['BORDER']};
    border-radius: 12px;
}}
QFrame#subCard {{
    background: {D['CARD']};
    border: 1px solid {D['BORDER']};
    border-radius: 8px;
}}
QFrame#statCard {{
    background: qlineargradient(x1:0, y1:0, x2:0, y2:1,
        stop:0 {D['CARD']}, stop:1 {D['PANEL']});
    border: 1px solid {D['BORDER']};
    border-radius: 10px;
}}
QLabel#cardTitle {{
    color: {D['CYAN']};
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 1px;
    text-transform: uppercase;
    padding-bottom: 4px;
    border-bottom: 1px solid {D['BORDER']};
}}

/* ─── Modern Tabs ─── */
QTabWidget::pane {{
    border: 1px solid {D['BORDER']};
    background: {D['PANEL']};
    border-radius: 8px;
    top: -1px;
}}
QTabBar::tab {{
    background: {D['BG']};
    color: {D['TEXT2']};
    border: 1px solid {D['BORDER']};
    border-bottom: none;
    padding: 8px 14px;
    margin-right: 4px;
    border-top-left-radius: 7px;
    border-top-right-radius: 7px;
    font-weight: 700;
    font-size: 11px;
}}
QTabBar::tab:hover {{
    background: {D['CARD']};
    color: {D['TEXT']};
}}
QTabBar::tab:selected {{
    background: {D['PANEL']};
    color: {D['ACCENT']};
    border-color: {D['BORDER']};
    border-top: 2px solid {D['ACCENT']};
}}

/* ─── Text inputs & Combos ─── */
QLineEdit, QComboBox, NoScrollSpinBox, NoScrollDoubleSpinBox {{
    background: {D['INPUT']};
    color: {D['TEXT']};
    border: 1px solid {D['BORDER']};
    border-radius: 6px;
    padding: 5px 10px;
    font-size: 12px;
    min-height: 22px;
    selection-background-color: {D['ACCENT2']};
}}
QLineEdit:hover, QComboBox:hover, NoScrollSpinBox:hover, NoScrollDoubleSpinBox:hover {{
    background: {D['INPUT_HI']};
    border-color: {D['BORDER2']};
}}
QLineEdit:focus, QComboBox:focus, NoScrollSpinBox:focus, NoScrollDoubleSpinBox:focus {{
    border: 1px solid {D['ACCENT']};
    background: {D['INPUT_HI']};
}}
QLineEdit:disabled, QComboBox:disabled, NoScrollSpinBox:disabled, NoScrollDoubleSpinBox:disabled {{
    color: {D['TEXT3']};
    background: {D['BG']};
    border-color: {D['BORDER']};
}}

/* ─── SpinBox Arrows ─── */
NoScrollSpinBox, NoScrollDoubleSpinBox {{ padding-right: 22px; }}
NoScrollSpinBox::up-button, NoScrollDoubleSpinBox::up-button {{
    subcontrol-origin: border;
    subcontrol-position: top right;
    width: 20px; height: 13px;
    border: none;
    border-top-right-radius: 5px;
    background: {D['CARD']};
    margin: 1px 1px 0 0;
}}
NoScrollSpinBox::down-button, NoScrollDoubleSpinBox::down-button {{
    subcontrol-origin: border;
    subcontrol-position: bottom right;
    width: 20px; height: 13px;
    border: none;
    border-bottom-right-radius: 5px;
    background: {D['CARD']};
    margin: 0 1px 1px 0;
}}
NoScrollSpinBox::up-button:hover, NoScrollSpinBox::down-button:hover,
NoScrollDoubleSpinBox::up-button:hover, NoScrollDoubleSpinBox::down-button:hover {{
    background: {D['ACCENT2']};
}}
NoScrollSpinBox::up-arrow, NoScrollDoubleSpinBox::up-arrow {{
    image: none; width: 0; height: 0;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-bottom: 5px solid {D['TEXT']};
}}
NoScrollSpinBox::down-arrow, NoScrollDoubleSpinBox::down-arrow {{
    image: none; width: 0; height: 0;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-top: 5px solid {D['TEXT']};
}}

/* ─── QComboBox drop-down ─── */
QComboBox {{ padding-right: 26px; }}
QComboBox::drop-down {{
    subcontrol-origin: padding;
    subcontrol-position: center right;
    width: 22px; border: none; background: transparent;
}}
QComboBox::down-arrow {{
    image: none; width: 0; height: 0;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-top: 6px solid {D['ACCENT']};
    margin-right: 6px;
}}
QComboBox QAbstractItemView {{
    background: {D['CARD']};
    color: {D['TEXT']};
    border: 1px solid {D['ACCENT']};
    border-radius: 6px;
    padding: 4px;
    selection-background-color: {D['ACCENT2']};
    selection-color: white;
    outline: 0;
}}

/* ─── Checkboxes ─── */
QCheckBox {{ color: {D['TEXT']}; spacing: 8px; padding: 3px 0; font-weight: 500; background: transparent; }}
QCheckBox:hover {{ color: {D['ACCENT']}; }}
QCheckBox::indicator {{
    width: 17px; height: 17px;
    border: 1.5px solid {D['BORDER2']};
    background: {D['INPUT']};
    border-radius: 4px;
}}
QCheckBox::indicator:hover {{ border-color: {D['ACCENT']}; }}
QCheckBox::indicator:checked {{
    background: {D['ACCENT']};
    border-color: {D['ACCENT']};
}}

/* ─── Buttons ─── */
QPushButton {{
    background: {D['CARD']};
    color: {D['TEXT']};
    border: 1px solid {D['BORDER2']};
    border-radius: 6px;
    padding: 7px 14px;
    font-weight: 600;
}}
QPushButton:hover {{
    background: {D['INPUT_HI']};
    border-color: {D['ACCENT']};
}}
QPushButton:pressed {{ background: {D['PANEL']}; }}
QPushButton:disabled {{
    color: {D['TEXT3']};
    background: {D['BG']};
    border-color: {D['BORDER']};
}}
QPushButton#startBtn {{
    background: qlineargradient(x1:0,y1:0,x2:1,y2:0,
        stop:0 {D['ACCENT2']}, stop:1 {D['PINK2']});
    color: white;
    border: 1px solid {D['ACCENT']};
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.6px;
    border-radius: 7px;
}}
QPushButton#startBtn:hover {{
    background: qlineargradient(x1:0,y1:0,x2:1,y2:0,
        stop:0 {D['ACCENT']}, stop:1 {D['PINK']});
}}
QPushButton#startBtn:disabled {{
    background: {D['BG']};
    color: {D['TEXT3']};
    border-color: {D['BORDER']};
}}
QPushButton#stopBtn {{
    background: rgba(248, 113, 113, 0.15);
    color: {D['RED']};
    border: 1px solid rgba(248, 113, 113, 0.45);
    font-size: 13px;
    font-weight: 800;
    border-radius: 7px;
}}
QPushButton#stopBtn:hover {{
    background: rgba(248, 113, 113, 0.28);
    border-color: {D['RED']};
}}
QPushButton#stopBtn:disabled {{
    background: {D['BG']};
    color: {D['TEXT3']};
    border-color: {D['BORDER']};
}}

/* ─── Log & Pool Text Areas ─── */
QTextEdit {{
    background: #050814;
    color: {D['TEXT']};
    border: 1px solid {D['BORDER']};
    border-radius: 8px;
    padding: 10px;
    font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 11px;
    selection-background-color: {D['ACCENT2']};
}}
QTextEdit:focus {{ border-color: {D['ACCENT']}; }}

/* ─── Scrollbars ─── */
QScrollBar:vertical {{
    background: {D['BG']};
    width: 10px;
    border-radius: 5px;
    margin: 0;
}}
QScrollBar::handle:vertical {{
    background: {D['BORDER2']};
    min-height: 28px;
    border-radius: 5px;
}}
QScrollBar::handle:vertical:hover {{ background: {D['ACCENT']}; }}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{ height: 0; background: none; }}
QScrollBar:horizontal {{
    background: {D['BG']};
    height: 10px;
    border-radius: 5px;
}}
QScrollBar::handle:horizontal {{
    background: {D['BORDER2']};
    min-width: 28px;
    border-radius: 5px;
}}
QScrollBar::handle:horizontal:hover {{ background: {D['ACCENT']}; }}
QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {{ width: 0; background: none; }}

/* ─── Tooltips ─── */
QToolTip {{
    background: {D['CARD']};
    color: {D['TEXT']};
    border: 1px solid {D['ACCENT']};
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 11px;
}}
"""


# (Ale 2026-11-14: "reemplazar esos emojis feos por nuestros emojis") Iconos del juego, 40 px, en base64.
ICONOS_JUEGO = {
    "hourglass": "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",
    "star": "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",
    "alert": "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",
    "gift": "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",
}
_RUTAS_ICONO: dict = {}


def icono_juego(nombre: str) -> QIcon:
    import base64
    pm = QPixmap()
    pm.loadFromData(base64.b64decode(ICONOS_JUEGO[nombre]), "PNG")
    return QIcon(pm)


def img_juego(nombre: str, alto: int = 16) -> str:
    """<img> para texto con formato (QLabel): se escribe una vez a la carpeta temporal."""
    import base64, tempfile
    if nombre not in _RUTAS_ICONO:
        ruta = os.path.join(tempfile.gettempdir(), f"gpui_{nombre}.png")
        try:
            with open(ruta, "wb") as f:
                f.write(base64.b64decode(ICONOS_JUEGO[nombre]))
        except Exception:
            pass
        _RUTAS_ICONO[nombre] = ruta.replace("\\", "/")
    return f'<img src="{_RUTAS_ICONO[nombre]}" height="{alto}" style="vertical-align: middle;">'


# ── EN / ES (Ale 2026-11-15: "un botón de traductor en el God Pack UI") ────────────────────────────────
# The panel is written in English; a timer swaps the visible texts to Spanish (and back) using these tables.
# Code keeps setting English texts (status, badge...): the next tick translates them. Combo boxes are read by
# currentData(), never by their text, so translating their items is safe. The choice is saved in lang.txt.
LANG_FILE = ROOT / "tools" / "god_pack_gui" / "lang.txt"

ES: dict = {
    # window / header / stats
    "God Pack Injection — Command Center": "God Pack Injection — Centro de control",
    "⚡ GOD PACK INJECTION": "⚡ GOD PACK INJECTION",
    "Headless Wonder-Pick Automation & Live Telemetry": "Automatización sin MuMu y telemetría en vivo",
    "Monitor Pokemon: checking version…": "Monitor Pokemon: revisando versión…",
    "Monitor Pokemon: version unknown (bot not running?)": "Monitor Pokemon: versión desconocida (¿el bot está apagado?)",
    "ACCOUNTS LEFT | OPENED": "CUENTAS RESTANTES | ABIERTAS",
    "ACCOUNTS PROCESSED": "CUENTAS PROCESADAS",
    "PACKS OPENED": "SOBRES ABIERTOS",
    "GOD PACK HITS": "GOD PACKS",
    "ELAPSED & SPEED": "TIEMPO Y VELOCIDAD",
    "click to view ▸": "clic para ver ▸",
    "Click to see the God Packs of this session": "Clic para ver los God Packs de esta sesión",
    "◈ LIVE ACTIVITY & PACK STREAM": "◈ ACTIVIDAD EN VIVO Y SOBRES",
    "Show FR cleanup": "Ver limpieza de solicitudes",
    "Raw RPC stream": "Log completo (RPC)",
    "Show individual DeleteV1 / CancelSentRequestsV1 lines.": "Muestra cada línea de DeleteV1 / CancelSentRequestsV1.",
    "Show 100% of raw console output including headers and debug lines.": "Muestra el 100% de la salida, con encabezados y líneas de depuración.",
    "Clear": "Limpiar",
    "Clear Feed": "Limpiar",
    "📄 View Pool .md": "📄 Ver Pool .md",
    "Open the historical god_pack_pool.md report.": "Abre el historial god_pack_pool.md.",
    "Waiting for activity... Any God Pack / Rare Pack hits (with full card lists) and critical headless errors (ABORTED, proxy dead, login failed) will be pinned here live.":
        "Esperando actividad... Los God Packs / sobres raros (con todas sus cartas) y los errores graves (ABORTED, proxy caído, login fallido) se fijan aquí en vivo.",
    # tabs
    "🎯 Farm && Pack": "🎯 Farmeo y sobres",
    "👥 Collectors && Discord": "👥 Mains y Discord",
    "⚡ Timing && Proxies": "⚡ Tiempos y proxies",
    "📂 Paths && Safety": "📂 Carpetas y seguridad",
    # tab Farm & Pack
    "📦 Pack & Mode Selection": "📦 Sobre y modo",
    "Run Mode": "Modo",
    "God Pack Farming (Send FR + Wishlist Match)": "God Pack (manda solicitudes + wishlist)",
    "Open Packs Only (No FR, No Wishlist)": "Solo abrir sobres (sin solicitudes ni wishlist)",
    "Pack to Open": "Sobre a abrir",
    "Packs to Open (tick one or more - the accounts take turns)": "Sobres a abrir (marca uno o más: las cuentas se turnan)",
    "Packs per Account": "Sobres por cuenta",
    "Packs to open per account per run.": "Sobres que abre cada cuenta en cada corrida.",
    "Min Hourglasses (0=off)": "Mín. relojes (0 = no)",
    "Skip accounts with fewer LARGE hourglasses than this (0 = off).": "Salta las cuentas con menos relojes que esto (0 = no).",
    "🌟 Wishlist & Threshold (God Pack Mode)": "🌟 Wishlist y mínimo (modo God Pack)",
    "Farming Mode": "Qué buscar",
    "Only GP (99% of members)": "Solo God Pack (99% de los miembros)",
    "GP & Double (2xSR normal packs too)": "God Pack y dobles (sobres normales con 2 SR)",
    "GP & Single or Double (1xSR or 2xSR normal packs)": "God Pack, simples o dobles (1 o 2 SR)",
    "Pack Power Minimum Threshold": "Calidad mínima del God Pack",
    "1/5 ☆ Minimum (one 2-star) (and higher)": "1/5 ☆ Mínimo (una de 2 estrellas) o más",
    "2/5 ☆☆ Good (two 2-star) (and higher)": "2/5 ☆☆ Bueno (dos de 2 estrellas) o más",
    "3/5 ☆☆☆ Very Good (three 2-star) (and higher)": "3/5 ☆☆☆ Muy bueno (tres de 2 estrellas) o más",
    "4/5 ☆☆☆☆ Excellent (four 2-star) (and higher)": "4/5 ☆☆☆☆ Excelente (cuatro de 2 estrellas) o más",
    "5/5 ☆☆☆☆☆ Perfect (all 2-star) (and higher)": "5/5 ☆☆☆☆☆ Perfecto (todas de 2 estrellas)",
    "⚙️ Quick Run Toggles": "⚙️ Opciones rápidas",
    "Free packs only — never spend hourglasses": "Solo sobres gratis — nunca gastar relojes",
    "Community Farm — also open lent accounts (Monitor Link)": "Granja de la comunidad — abrir también cuentas prestadas (Monitor Link)",
    "Ticked: your accounts + the community's lent accounts (counters show all).\nUnticked: only your own accounts (counters show only yours).":
        "Marcado: tus cuentas + las prestadas por la comunidad (los contadores muestran todo).\nDesmarcado: solo tus cuentas (los contadores muestran solo las tuyas).",
    "Your accounts + the community's lent accounts (counters show all).": "Tus cuentas + las prestadas por la comunidad (los contadores muestran todo).",
    "Only your own accounts (counters show only yours).": "Solo tus cuentas (los contadores muestran solo las tuyas).",
    "Tick at least one pack.": "Marca al menos un sobre.",
    "1 pack: every account opens it.": "1 sobre: todas las cuentas abren ese.",
    "Spend all hourglasses — Open Packs Only, your accounts": "Gastar todos los relojes — Solo abrir sobres, tus cuentas",
    "Each account opens its free packs + every paid pack its LARGE hourglasses can pay\n(12 per pack). Ignores 'Packs per Account'. Lent accounts never spend hourglasses.":
        "Cada cuenta abre sus sobres gratis + todos los que pueda pagar con relojes\n(12 por sobre). No usa 'Sobres por cuenta'. Las cuentas prestadas nunca gastan relojes.",
    "Claim gifts && finished missions — Open Packs Only, your accounts": "Cobrar regalos y misiones — Solo abrir sobres, tus cuentas",
    "Before opening: receive everything in the gift box (often hourglasses).\nAfter opening: claim the missions that got finished.":
        "Antes de abrir: recibe todo el buzón de regalos (suelen ser relojes).\nDespués de abrir: cobra las misiones terminadas y los días de los eventos.",
    "  Hourglasses list": "  Lista de relojes",
    "  Claim only — your accounts": "  Solo cobrar — tus cuentas",
    "Logs into every one of your accounts (even the resting ones) and claims gifts,\nfinished missions and event days. Opens no packs and doesn't touch the cooldown.":
        "Entra a todas tus cuentas (aunque estén descansando) y cobra regalos,\nmisiones terminadas y días de eventos. No abre sobres ni cambia el descanso.",
    "Update needed": "Falta actualizar",
    "Hourglasses left on each of your accounts (updated while the bot runs).": "Relojes que le quedan a cada cuenta tuya (se actualiza mientras corre).",
    "▶  START INJECTION": "▶  INICIAR",
    "■  STOP": "■  DETENER",
    "⚠ FORCE KILL": "⚠ FORZAR CIERRE",
    "💾 Save Settings": "💾 Guardar ajustes",
    "🧹 Cleanup Leftover FRs": "🧹 Limpiar solicitudes",
    "Runs inject.py --cleanup-only: logs into accounts in fr_ledger.json and withdraws pending/accepted collector friend requests.":
        "Entra a las cuentas de fr_ledger.json y retira las solicitudes de amistad pendientes o aceptadas de los Mains.",
    "Idle. Ready to start.": "En espera. Listo para iniciar.",
    "Running injection...": "Abriendo sobres...",
    "Stopping — cleaning up friend requests...": "Deteniendo — limpiando solicitudes de amistad...",
    "Community farm running.": "Granja de la comunidad en marcha.",
    "Idle (Community farm stopped).": "En espera (granja de la comunidad detenida).",
    "Own accounts done — Community farm still running.": "Tus cuentas listas — la granja de la comunidad sigue.",
    "Cleared all manual collector codes.": "Se borraron todos los códigos de Mains.",
    # tab Collectors & Discord
    "👥 Collector Friend Codes & Live Worker": "👥 Códigos de Mains y Worker en vivo",
    "Manual Collector IDs (16-digit friend codes or UUIDs):": "IDs de Mains a mano (código de amigo de 16 dígitos o UUID):",
    "9370-0010-9308-6237 or UUID...": "9370-0010-9308-6237 o UUID...",
    "+ Add": "+ Agregar",
    "Remove": "Quitar",
    "Clear All": "Borrar todo",
    "Cloudflare Worker URL (Live IDs)": "URL del Worker de Cloudflare (IDs en vivo)",
    "Cloudflare Worker URL for live online collector IDs.": "URL del Worker con los IDs de los Mains en línea.",
    "Friend requests go to ALL listed collectors + live Worker URL. If no god pack is pulled, all links are automatically removed.":
        "Las solicitudes van a TODOS los Mains de la lista + los del Worker. Si no sale God Pack, se borran solas.",
    "🔔 Discord Webhooks & Heartbeat": "🔔 Webhooks de Discord y heartbeat",
    "God Pack Hit Webhook URL": "Webhook para los God Packs",
    "Mention ID on God Pack Hit": "ID a mencionar con un God Pack",
    "Discord User/Role ID to ping on hit (empty = none)": "ID de usuario o rol de Discord a mencionar (vacío = nadie)",
    "PPM Status Monitor Webhook URL": "Webhook del estado de PPM",
    "https://discord.com/api/webhooks/... (empty = disabled)": "https://discord.com/api/webhooks/... (vacío = apagado)",
    "PPM Heartbeat Interval": "Cada cuánto manda el PPM",
    "Host Name (shown in Discord)": "Nombre del host (se ve en Discord)",
    "❤️ Showcase Collection Likes": "❤️ Likes a colecciones",
    "Send collection likes (first 5 accounts, once per 24h cycle)": "Dar likes a colecciones (primeras 5 cuentas, una vez cada 24 h)",
    "Like Targets File": "Archivo de destinos de likes",
    "📝 Open / Edit Like Targets File": "📝 Abrir / editar destinos de likes",
    "Browse for Like Targets File": "Buscar el archivo de destinos de likes",
    # tab Timing & Proxies
    "⚡ Concurrency, Delays & Rate Limits": "⚡ Simultáneas, pausas y límites",
    "Parallel Workers": "Cuentas a la vez",
    "Max Accounts Limit (0=all)": "Máx. de cuentas (0 = todas)",
    "Wait After FR Send": "Espera tras mandar solicitud",
    "Poll Accept Timeout (0=off)": "Esperar que acepten (0 = no)",
    "Account Cooldown": "Descanso de cada cuenta",
    "Delay Between Packs": "Pausa entre sobres",
    "Delay Between Accounts": "Pausa entre cuentas",
    "Max FR/min (per collector)": "Máx. solicitudes/min (por Main)",
    "Packs/min Cap (per collector)": "Tope de sobres/min (por Main)",
    "Auto-Stop After N Fails": "Parar tras N fallos",
    "Account Processing Order": "Orden de las cuentas",
    "Filename (alphabetical, default)": "Por nombre (alfabético, normal)",
    "Newest first (most recently drained)": "Más recientes primero",
    "Oldest first (longest since last pack)": "Más antiguas primero (las que más esperaron)",
    "🌐 Proxy Pool & Health Checks": "🌐 Proxies y chequeos",
    "Proxy List File": "Archivo de proxies",
    "Browse for Proxy List File": "Buscar el archivo de proxies",
    "Proxy Scheme": "Tipo de proxy",
    "Max Proxies Tried / Account": "Máx. proxies por cuenta",
    "Health Checks Before Dead": "Chequeos antes de darlo por caído",
    "Gap Between Checks": "Pausa entre chequeos",
    "Revive Dead Proxy After": "Revivir proxy caído después de",
    "Shuffle proxy pool order on startup": "Mezclar el orden de los proxies al iniciar",
    "Verify pack power with server before sending FR": "Confirmar el poder de sobre con el servidor antes de mandar solicitudes",
    # tab Paths & Safety
    "📂 Account Credential Directories": "📂 Carpetas de cuentas",
    "XML Directory (searched recursively)": "Carpeta de XML (incluye subcarpetas)",
    "Browse for XML Directory (searched recursively)": "Buscar la carpeta de XML",
    "JSON Directory (matched by basename or deviceAccount)": "Carpeta de JSON (por nombre o deviceAccount)",
    "Browse for JSON Directory (matched by basename or deviceAccount)": "Buscar la carpeta de JSON",
    "(optional) leave blank to use Fallback Accounts dir": "(opcional) vacío = usar la carpeta de respaldo",
    "Fallback Accounts Directory (when XML/JSON blank)": "Carpeta de respaldo (si XML/JSON están vacías)",
    "Browse for Fallback Accounts Directory (when XML/JSON blank)": "Buscar la carpeta de respaldo",
    "When XML/JSON dirs are set, XML dir is scanned recursively and matched to JSONs automatically.":
        "Con las carpetas XML/JSON puestas, se revisan todos los XML y se emparejan solos con sus JSON.",
    "🛡️ Safety, Popups & Quarantine": "🛡️ Seguridad, avisos y cuarentena",
    "Dismiss welcome-back / 60HG popups on old accounts (recommended)": "Cerrar avisos de bienvenida / 60 relojes en cuentas viejas (recomendado)",
    "Quarantine locked/banned accounts (moves to QUARANTINE/ folder)": "Poner en cuarentena las cuentas bloqueadas/baneadas (carpeta QUARANTINE)",
    "Dry run (test flow without opening packs)": "Prueba en seco (sin abrir sobres)",
}

# Texts that change while it runs: (English regex, Spanish template).
ES_RE = [
    (r"^Time left: (.*)$", r"Tiempo restante: \1"),
    (r"^(\d+) packs: account 1 opens the 1st, account 2 the 2nd, \.\.\. and it starts over\.$",
     r"\1 sobres: la cuenta 1 abre el 1º, la cuenta 2 el 2º, ... y vuelve a empezar."),
    (r"^Idle \(last exit: (.*)\)\.$", r"En espera (última salida: \1)."),
    (r"^Settings saved to (.*)\.$", r"Ajustes guardados en \1."),
    (r"^Already in list: (.*)$", r"Ya está en la lista: \1"),
    (r"^Added (.*)\. (\d+) collector\(s\) total\.$", r"Agregado \1. \2 Main(s) en total."),
    (r"^Removed (\d+)\. (\d+) collector\(s\) remaining\.$", r"Quitados \1. Quedan \2 Main(s)."),
    (r"^Speed set for (.*?): Parallel (.*?) · (.*?)s between accounts · (.*?)s between packs \(Timing tab\)\.$",
     r"Velocidad para \1: \2 a la vez · \3 s entre cuentas · \4 s entre sobres (pestaña Tiempos)."),
    (r"^● IDLE$", "● EN ESPERA"), (r"^● RUNNING$", "● CORRIENDO"), (r"^● STOPPING$", "● DETENIENDO"),
    (r"^● COMMUNITY$", "● COMUNIDAD"),
    (r"^(✅ Monitor Pokemon v\S+) — up to date$", r"\1 — al día"),
    (r"^(⏳ Monitor Pokemon v\S+) — updating to (v\S+)…$", r"\1 — actualizando a \2…"),
    (r"^⚠️ Monitor Pokemon updated to (v\S+) — close and reopen this window$",
     r"⚠️ Monitor Pokemon se actualizó a \1 — cierra y abre esta ventana"),
]
# Pieces inside rich text (labels with game icons).
ES_TROZOS = [("LIVE GOD PACK HITS &amp; CRITICAL ALERTS", "GOD PACKS EN VIVO &amp; ALERTAS CRÍTICAS"),
             (" Alerts", " Alertas")]


def _a_es(t: str) -> str:
    if t in ES:
        return ES[t]
    for pat, rep in ES_RE:
        nuevo, n = re.subn(pat, rep, t)
        if n:
            return nuevo
    if "<img" in t:
        for a, b in ES_TROZOS:
            t = t.replace(a, b)
    return t


def leer_idioma() -> str:
    try:
        return "es" if LANG_FILE.read_text("utf-8").strip().lower() == "es" else "en"
    except Exception:
        return "en"


def traducir_ventana(win, idioma: str) -> None:
    """Each text keeps (english, spanish); in ES a new English text is translated, in EN the original comes back."""
    widgets = [win] + win.findChildren(QWidget)
    for top in QApplication.topLevelWidgets():
        if top is not win and top.isVisible():
            widgets += [top] + top.findChildren(QWidget)
    for w in widgets:
        memo = w.property("_tr")
        memo = dict(memo) if isinstance(memo, dict) else {}
        cambio = False
        pares = []
        for get, set_ in (("text", "setText"), ("title", "setTitle"), ("placeholderText", "setPlaceholderText"),
                          ("toolTip", "setToolTip"), ("windowTitle", "setWindowTitle")):
            if isinstance(w, QLineEdit) and get == "text":
                continue   # what the user typed (paths, IDs, URLs)
            f = getattr(w, get, None)
            if callable(f) and callable(getattr(w, set_, None)):
                pares.append((get, f, getattr(w, set_)))
        if isinstance(w, QComboBox):
            for i in range(w.count()):
                pares.append((f"item{i}", (lambda i=i, w=w: w.itemText(i)), (lambda v, i=i, w=w: w.setItemText(i, v))))
        if isinstance(w, QTabWidget):
            for i in range(w.count()):
                pares.append((f"tab{i}", (lambda i=i, w=w: w.tabText(i)), (lambda v, i=i, w=w: w.setTabText(i, v))))
        for clave, get, set_ in pares:
            try:
                actual = get()
            except Exception:
                continue
            if not isinstance(actual, str) or not actual:
                continue
            en, es = memo.get(clave, (None, None))
            if idioma == "es":
                if actual == es:
                    continue
                trad = _a_es(actual)
                memo[clave] = (actual, trad)
                cambio = True
                if trad != actual:
                    set_(trad)
            elif es is not None and actual == es and en != es:
                set_(en)
                memo[clave] = (en, en)
                cambio = True
        if cambio:
            w.setProperty("_tr", memo)


class NoScrollSpinBox(QSpinBox):
    def wheelEvent(self, event):
        event.ignore()


class NoScrollDoubleSpinBox(QDoubleSpinBox):
    def wheelEvent(self, event):
        event.ignore()


# (Ale 2026-11-14) The mouse wheel over a list changed the setting by itself: lists only change by clicking.
class NoScrollComboBox(QComboBox):
    def wheelEvent(self, event):
        event.ignore()


class GodPackGui(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("God Pack Injection — Command Center")
        self.resize(1360, 860)
        self.setMinimumSize(860, 560)
        self.setStyleSheet(STYLESHEET)

        self.proc: QProcess | None = None
        self._stop_f: Path | None = None
        self._run_id = 0
        self._stopping = False
        self._close_after_finish = False
        self._community = False
        self._community_pos = 0

        # Tracking structures for live event feed & card correlation
        self._last_pack_line: dict[str, str] = {}
        self._pending_hit_header: dict[str, str] = {}
        self._gp_counted: set[str] = set()   # accounts whose God Pack is already in GOD PACK HITS
        self._events_count = {"hits": 0, "errors": 0}

        self._build_ui()
        self._load_settings()

        self._lang = leer_idioma()
        self._lang_timer = QTimer(self)
        self._lang_timer.timeout.connect(self._apply_lang)
        self._lang_timer.start(500)
        self._apply_lang()

        # Auto-start if launched from AutoStart.ahk with --autostart
        if "--autostart" in sys.argv:
            QTimer.singleShot(1500, self._start_injection)

    # ── UI BUILDER ─────────────────────────────────────────────────
    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        root = QHBoxLayout(central)
        root.setContentsMargins(14, 14, 14, 14)
        root.setSpacing(0)

        splitter = QSplitter(Qt.Horizontal)
        splitter.setChildrenCollapsible(False)
        splitter.setHandleWidth(10)
        splitter.setStyleSheet(
            f"QSplitter::handle:horizontal {{"
            f"    background: {D['BORDER']};"
            f"    border-left: 3px solid {D['BG']};"
            f"    border-right: 3px solid {D['BG']};"
            f"}}"
            f"QSplitter::handle:horizontal:hover {{"
            f"    background: {D['ACCENT']};"
            f"}}"
        )
        root.addWidget(splitter)

        # ══════════════════════════════════════════════════════════════
        # LEFT PANEL — Header + Tabbed Configuration + Fixed Action Dock
        # ══════════════════════════════════════════════════════════════
        left_panel = QFrame(objectName="mainPanel")
        left_panel.setMinimumWidth(430)
        left_vbox = QVBoxLayout(left_panel)
        left_vbox.setContentsMargins(14, 14, 14, 14)
        left_vbox.setSpacing(10)

        # 1. Header Banner
        header_row = QHBoxLayout()
        header_row.setSpacing(10)
        title_box = QVBoxLayout()
        title_box.setSpacing(1)
        lbl_title = QLabel("⚡ GOD PACK INJECTION")
        lbl_title.setStyleSheet(
            f"color: {D['TEXT']}; font-size: 16px; font-weight: 900; letter-spacing: 0.8px;"
        )
        lbl_sub = QLabel("Headless Wonder-Pick Automation & Live Telemetry")
        lbl_sub.setStyleSheet(f"color: {D['TEXT3']}; font-size: 11px;")
        title_box.addWidget(lbl_title)
        title_box.addWidget(lbl_sub)
        # Ale 2026-11-06: Monitor Pokemon version of this host, up to date or not, and a warning when the host
        # updated after this window was opened (close and reopen it to load the new panel/notifier).
        self.lbl_version = QLabel("Monitor Pokemon: checking version…")
        self.lbl_version.setStyleSheet(f"color: {D['TEXT3']}; font-size: 10px;")
        title_box.addWidget(self.lbl_version)
        self._version_al_abrir = None
        self._version_timer = QTimer(self)
        self._version_timer.timeout.connect(self._update_version_label)
        self._version_timer.start(30000)
        QTimer.singleShot(1500, self._update_version_label)
        header_row.addLayout(title_box, 1)

        self.badge_status = QLabel("● IDLE")
        self.badge_status.setStyleSheet(
            f"background: {D['CARD']}; color: {D['TEXT2']}; border: 1px solid {D['BORDER2']}; "
            f"border-radius: 11px; padding: 4px 12px; font-size: 11px; font-weight: 800;"
        )
        header_row.addWidget(self.badge_status, 0, Qt.AlignRight | Qt.AlignVCenter)
        # EN / ES (Ale 2026-11-15): shows the language you switch TO.
        self.btn_lang = QPushButton()
        self.btn_lang.setCursor(Qt.PointingHandCursor)
        self.btn_lang.setFixedWidth(46)
        self.btn_lang.setStyleSheet(
            f"QPushButton {{ background: {D['CARD']}; color: {D['TEXT']}; border: 1px solid {D['BORDER2']}; "
            f"border-radius: 11px; padding: 4px 6px; font-size: 11px; font-weight: 800; }}"
            f"QPushButton:hover {{ border-color: {D['ACCENT']}; }}")
        self.btn_lang.clicked.connect(self._toggle_lang)
        header_row.addWidget(self.btn_lang, 0, Qt.AlignRight | Qt.AlignVCenter)
        left_vbox.addLayout(header_row)

        # 2. Tab Widget (4 Categorized Tabs)
        self.tabs = QTabWidget()
        left_vbox.addWidget(self.tabs, 1)

        self._build_tab_farm()
        self._build_tab_collectors()
        self._build_tab_timing_proxy()
        self._build_tab_paths_safety()

        # 3. Fixed Bottom Command Dock
        dock = QFrame(objectName="subCard")
        dock_layout = QVBoxLayout(dock)
        dock_layout.setContentsMargins(10, 10, 10, 10)
        dock_layout.setSpacing(8)

        main_btns = QHBoxLayout()
        main_btns.setSpacing(8)

        self.btn_start = QPushButton("▶  START INJECTION")
        self.btn_start.setObjectName("startBtn")
        self.btn_start.setFixedHeight(38)
        self.btn_start.setCursor(Qt.PointingHandCursor)
        self.btn_start.clicked.connect(self._start_injection)
        main_btns.addWidget(self.btn_start, 2)

        self.btn_stop = QPushButton("■  STOP")
        self.btn_stop.setObjectName("stopBtn")
        self.btn_stop.setFixedHeight(38)
        self.btn_stop.setCursor(Qt.PointingHandCursor)
        self.btn_stop.clicked.connect(self._stop_injection)
        self.btn_stop.setEnabled(False)
        main_btns.addWidget(self.btn_stop, 1)
        dock_layout.addLayout(main_btns)

        sub_btns = QHBoxLayout()
        sub_btns.setSpacing(8)

        self.btn_save = QPushButton("💾 Save Settings")
        self.btn_save.setFixedHeight(28)
        self.btn_save.setCursor(Qt.PointingHandCursor)
        self.btn_save.clicked.connect(self._save_settings)
        sub_btns.addWidget(self.btn_save, 1)

        self.btn_cleanup = QPushButton("🧹 Cleanup Leftover FRs")
        self.btn_cleanup.setFixedHeight(28)
        self.btn_cleanup.setCursor(Qt.PointingHandCursor)
        self.btn_cleanup.setToolTip(
            "Runs inject.py --cleanup-only: logs into accounts in fr_ledger.json "
            "and withdraws pending/accepted collector friend requests."
        )
        self.btn_cleanup.clicked.connect(self._start_cleanup_only)
        sub_btns.addWidget(self.btn_cleanup, 1)
        # FARM96_WINDOW_V1 (Ale/Arcade 2026-11-19): members' /farm runs, in their own window.
        self.btn_farm96 = QPushButton("📦 /farm")
        self.btn_farm96.setFixedHeight(28)
        self.btn_farm96.setCursor(Qt.PointingHandCursor)
        self.btn_farm96.setToolTip("What members are opening on their lent accounts with /farm on this host\n"
                                   "(only when this host has the community turn). It doesn't count in your PPM.")
        self.btn_farm96.clicked.connect(self._show_farm96)
        sub_btns.addWidget(self.btn_farm96, 1)
        dock_layout.addLayout(sub_btns)

        self.status_label = QLabel("Idle. Ready to start.")
        self.status_label.setStyleSheet(f"color: {D['TEXT2']}; font-size: 11px;")
        dock_layout.addWidget(self.status_label)

        left_vbox.addWidget(dock)

        # ══════════════════════════════════════════════════════════════
        # RIGHT PANEL — Live KPI Cards + Color Activity Log + Hits/Error Feed
        # ══════════════════════════════════════════════════════════════
        right_widget = QWidget()
        right_widget.setMinimumWidth(480)
        right = QVBoxLayout(right_widget)
        right.setContentsMargins(10, 0, 0, 0)
        right.setSpacing(10)

        # 1. KPI Telemetry Cards Row
        stats_row = QHBoxLayout()
        stats_row.setSpacing(10)
        self.stat_accounts = self._create_stat_card("ACCOUNTS PROCESSED", "0", D["CYAN"])
        self.stat_packs = self._create_stat_card("PACKS OPENED", "0", D["ACCENT"])
        self.stat_matches = self._create_stat_card("GOD PACK HITS", "0", D["GOLD"])
        self.stat_ppm = self._create_stat_card("ELAPSED & SPEED", "0.0m | 0.0 PPM", D["GREEN"])
        # Ale 2026-11-06: accounts still to open (own + lent of this host, in the panel's Run Mode) | opened.
        self.stat_left = self._create_stat_card("ACCOUNTS LEFT | OPENED", "0 | 0", D["CYAN"])
        self._own_total = 0; self._own_done = 0; self._own_opened = 0
        # Ale 2026-11-09: estimated time to finish the accounts left, at this session's speed.
        self.stat_left._eta = QLabel("Time left: —")
        self.stat_left._eta.setStyleSheet(f"color: {D['TEXT2']}; font-size: 11px; font-weight: 700;")
        self.stat_left.layout().addWidget(self.stat_left._eta)
        # Ale 2026-11-09: click on GOD PACK HITS = window with this session's God Packs (name, ID, XML, cards).
        self.stat_matches.setCursor(Qt.PointingHandCursor)
        self.stat_matches.setToolTip("Click to see the God Packs of this session")
        self.stat_matches.mousePressEvent = lambda _e: self._show_gp_hits_dialog()
        hint = QLabel("click to view ▸")
        hint.setStyleSheet(f"color: {D['TEXT2']}; font-size: 11px; font-weight: 700;")
        self.stat_matches.layout().addWidget(hint)
        stats_row.addWidget(self.stat_left)
        stats_row.addWidget(self.stat_accounts)
        stats_row.addWidget(self.stat_packs)
        stats_row.addWidget(self.stat_matches)
        stats_row.addWidget(self.stat_ppm)
        right.addLayout(stats_row)

        # 2. Vertical Splitter between Top Activity Log and Bottom Hits & Alerts Feed
        right_splitter = QSplitter(Qt.Vertical)
        right_splitter.setChildrenCollapsible(False)
        right_splitter.setHandleWidth(8)

        # --- Top Panel: Live Activity & Pack Stream ---
        log_container = QFrame(objectName="mainPanel")
        log_vbox = QVBoxLayout(log_container)
        log_vbox.setContentsMargins(12, 10, 12, 12)
        log_vbox.setSpacing(6)

        log_top_bar = QHBoxLayout()
        log_top_bar.setSpacing(8)
        log_header = QLabel("◈ LIVE ACTIVITY & PACK STREAM")
        log_header.setStyleSheet(
            f"color: {D['CYAN']}; font-size: 12px; font-weight: 800; letter-spacing: 1px;"
        )
        log_top_bar.addWidget(log_header)
        log_top_bar.addStretch(1)

        self.w_show_cleanup = QCheckBox("Show FR cleanup")
        self.w_show_cleanup.setChecked(False)
        self.w_show_cleanup.setToolTip("Show individual DeleteV1 / CancelSentRequestsV1 lines.")
        log_top_bar.addWidget(self.w_show_cleanup)

        self.w_verbose = QCheckBox("Raw RPC stream")
        self.w_verbose.setToolTip("Show 100% of raw console output including headers and debug lines.")
        log_top_bar.addWidget(self.w_verbose)

        btn_clear_log = QPushButton("Clear")
        btn_clear_log.setFixedHeight(24)
        btn_clear_log.setCursor(Qt.PointingHandCursor)
        btn_clear_log.clicked.connect(lambda: self.log_view.clear())
        log_top_bar.addWidget(btn_clear_log)
        log_vbox.addLayout(log_top_bar)

        self.log_view = QTextEdit()
        self.log_view.setReadOnly(True)
        self.log_view.document().setMaximumBlockCount(5000)
        self.log_view.setLineWrapMode(QTextEdit.NoWrap)
        log_vbox.addWidget(self.log_view, 1)
        right_splitter.addWidget(log_container)

        # --- Bottom Panel: Live God Pack Hits & Critical Alerts ---
        pool_container = QFrame(objectName="mainPanel")
        pool_vbox = QVBoxLayout(pool_container)
        pool_vbox.setContentsMargins(12, 10, 12, 12)
        pool_vbox.setSpacing(6)

        pool_top_bar = QHBoxLayout()
        pool_top_bar.setSpacing(8)
        pool_header = QLabel(f"{img_juego('star', 15)}&nbsp; LIVE GOD PACK HITS &amp; CRITICAL ALERTS")
        pool_header.setTextFormat(Qt.RichText)
        pool_header.setStyleSheet(
            f"color: {D['GOLD']}; font-size: 12px; font-weight: 800; letter-spacing: 1px;"
        )
        pool_top_bar.addWidget(pool_header)
        pool_top_bar.addStretch(1)

        self.live_label = QLabel(f"{img_juego('star', 14)} 0 Hits &nbsp;·&nbsp; {img_juego('alert', 14)} 0 Alerts")
        self.live_label.setTextFormat(Qt.RichText)
        self.live_label.setStyleSheet(f"color: {D['TEXT2']}; font-size: 11px; font-weight: 700;")
        pool_top_bar.addWidget(self.live_label)

        btn_view_md = QPushButton("📄 View Pool .md")
        btn_view_md.setFixedHeight(24)
        btn_view_md.setCursor(Qt.PointingHandCursor)
        btn_view_md.setToolTip("Open the historical god_pack_pool.md report.")
        btn_view_md.clicked.connect(self._show_pool_report_dialog)
        pool_top_bar.addWidget(btn_view_md)

        btn_clear_events = QPushButton("Clear Feed")
        btn_clear_events.setFixedHeight(24)
        btn_clear_events.setCursor(Qt.PointingHandCursor)
        btn_clear_events.clicked.connect(self._clear_events_feed)
        pool_top_bar.addWidget(btn_clear_events)
        pool_vbox.addLayout(pool_top_bar)

        self.pool_view = QTextEdit()
        self.pool_view.setReadOnly(True)
        self.pool_view.document().setMaximumBlockCount(2000)
        self.pool_view.setLineWrapMode(QTextEdit.NoWrap)
        self.pool_view.setPlaceholderText(
            "Waiting for activity... Any God Pack / Rare Pack hits (with full card lists) "
            "and critical headless errors (ABORTED, proxy dead, login failed) will be pinned here live."
        )
        pool_vbox.addWidget(self.pool_view, 1)
        right_splitter.addWidget(pool_container)

        right_splitter.setSizes([470, 270])
        right.addWidget(right_splitter, 1)

        # ── Batched stdout state ──
        self._stdout_raw_pending: bytearray = bytearray()
        self._stdout_line_tail: str = ""
        self._log_pending: list[str] = []
        self._events_pending: list[str] = []
        self._live_tail: str = ""
        self._live = {"accounts": 0, "packs": 0, "matches": 0, "errors": 0, "t0": None}
        self._log_flush_timer = QTimer(self)
        self._log_flush_timer.setInterval(250)
        self._log_flush_timer.timeout.connect(self._flush_log_buffer)
        self._log_flush_timer.start()

        splitter.addWidget(left_panel)
        splitter.addWidget(right_widget)
        splitter.setSizes([470, 870])
        splitter.setStretchFactor(0, 0)
        splitter.setStretchFactor(1, 1)

    # ── TAB 1: FARM & PACK ─────────────────────────────────────────
    def _build_tab_farm(self):
        page, lay = self._make_scrollable_tab()

        c_pack, l_pack = self._make_card("📦 Pack & Mode Selection")
        self.w_run_mode = NoScrollComboBox()
        self.w_run_mode.addItem("God Pack Farming (Send FR + Wishlist Match)", "godpack")
        self.w_run_mode.addItem("Open Packs Only (No FR, No Wishlist)", "packs-only")
        self.w_run_mode.currentIndexChanged.connect(self._update_mode_enabled)
        self.w_run_mode.currentIndexChanged.connect(self._apply_mode_timing)
        self._add_field(l_pack, "Run Mode", self.w_run_mode)

        self.w_pack = NoScrollComboBox()
        for pack in paid_pack_options():
            label = f"[{pack.get('sku_id', '?')}] {pack.get('name', '?')} — {pack['pack_id']}"
            self.w_pack.addItem(label, pack["pack_id"])
        default_idx = max(0, self.w_pack.findData(DEFAULT_PAID_PACK_ID))
        self.w_pack.setCurrentIndex(default_idx)
        self._pack_one_field = self._wrap_field("Pack to Open", self.w_pack)
        l_pack.addWidget(self._pack_one_field)

        # 2026-11-12 (Ale/Arcade): Open Packs Only can open several packs; the accounts take turns
        # (account 1 the 1st pack, account 2 the 2nd, ...).
        self.w_pack_multi = QListWidget()
        self.w_pack_multi.setFixedHeight(150)
        self.w_pack_multi.setStyleSheet(
            f"QListWidget {{ background: {D['INPUT']}; border: 1px solid {D['BORDER']}; "
            f"border-radius: 6px; padding: 4px; color: {D['TEXT']}; }}"
            f"QListWidget::item {{ padding: 3px 6px; }}")
        for pack in paid_pack_options():
            it = QListWidgetItem(f"[{pack.get('sku_id', '?')}] {pack.get('name', '?')}")
            it.setData(Qt.UserRole, pack["pack_id"])
            it.setFlags(it.flags() | Qt.ItemIsUserCheckable)
            it.setCheckState(Qt.Checked if pack["pack_id"] == DEFAULT_PAID_PACK_ID else Qt.Unchecked)
            self.w_pack_multi.addItem(it)
        self.w_pack_multi.itemChanged.connect(lambda _it: self._update_pack_multi_hint())
        self._pack_multi_field = self._wrap_field("Packs to Open (tick one or more - the accounts take turns)",
                                                  self.w_pack_multi)
        l_pack.addWidget(self._pack_multi_field)
        self.w_pack_multi_hint = QLabel("")
        self.w_pack_multi_hint.setStyleSheet(f"color: {D['TEXT2']}; font-size: 11px;")
        self.w_pack_multi_hint.setWordWrap(True)
        l_pack.addWidget(self.w_pack_multi_hint)

        grid_p = QGridLayout()
        grid_p.setSpacing(8)
        self.w_packs = NoScrollSpinBox()
        self.w_packs.setRange(1, 100)
        self.w_packs.setValue(2)
        self.w_packs.setToolTip("Packs to open per account per run.")
        grid_p.addWidget(self._wrap_field("Packs per Account", self.w_packs), 0, 0)

        self.w_min_hourglass = NoScrollSpinBox()
        self.w_min_hourglass.setRange(0, 100000)
        self.w_min_hourglass.setSingleStep(12)
        self.w_min_hourglass.setValue(0)
        self.w_min_hourglass.setToolTip("Skip accounts with fewer LARGE hourglasses than this (0 = off).")
        grid_p.addWidget(self._wrap_field("Min Hourglasses (0=off)", self.w_min_hourglass), 0, 1)
        l_pack.addLayout(grid_p)
        lay.addWidget(c_pack)

        c_wish, l_wish = self._make_card("🌟 Wishlist & Threshold (God Pack Mode)")
        self.w_farming_mode = NoScrollComboBox()
        self.w_farming_mode.addItem("Only GP (99% of members)", "only_gp")
        self.w_farming_mode.addItem("GP & Double (2xSR normal packs too)", "gp_double")
        self.w_farming_mode.addItem("GP & Single or Double (1xSR or 2xSR normal packs)", "gp_single")
        self._add_field(l_wish, "Farming Mode", self.w_farming_mode)

        self.w_pack_power_min = NoScrollComboBox()
        tier_descriptions = [
            ("5/5", "5/5 ☆☆☆☆☆ Perfect (all 2-star)"),
            ("4/5", "4/5 ☆☆☆☆ Excellent (four 2-star)"),
            ("3/5", "3/5 ☆☆☆ Very Good (three 2-star)"),
            ("2/5", "2/5 ☆☆ Good (two 2-star)"),
            ("1/5", "1/5 ☆ Minimum (one 2-star)"),
        ]
        for tier_value, tier_label in tier_descriptions:
            self.w_pack_power_min.addItem(f"{tier_label} (and higher)", tier_value)
        self.w_pack_power_min.setCurrentIndex(2)
        self._add_field(l_wish, "Pack Power Minimum Threshold", self.w_pack_power_min)
        lay.addWidget(c_wish)

        c_flags, l_flags = self._make_card("⚙️ Quick Run Toggles")
        self.w_free_only = QCheckBox("Free packs only — never spend hourglasses")
        self.w_free_only.setChecked(False)
        l_flags.addWidget(self.w_free_only)

        self.w_community = QCheckBox("Community Farm — also open lent accounts (Monitor Link)")
        self.w_community.setChecked(True)
        self.w_community.setToolTip("Ticked: your accounts + the community's lent accounts (counters show all).\n"
                                    "Unticked: only your own accounts (counters show only yours).")
        self.w_community.toggled.connect(self._update_community_hint)
        l_flags.addWidget(self.w_community)
        self.w_community_hint = QLabel("")
        self.w_community_hint.setStyleSheet(f"color: {D['TEXT2']}; font-size: 11px; margin-left: 22px;")
        l_flags.addWidget(self.w_community_hint)
        self._update_community_hint()

        # (Ale 2026-11-12) Hourglasses + rewards: own accounts only (lent accounts never spend anything).
        self.w_spend_all = QCheckBox("Spend all hourglasses — Open Packs Only, your accounts")
        self.w_spend_all.setToolTip("Each account opens its free packs + every paid pack its LARGE hourglasses can pay\n"
                                    "(12 per pack). Ignores 'Packs per Account'. Lent accounts never spend hourglasses.")
        self.w_spend_all.toggled.connect(lambda on: on and self.w_free_only.setChecked(False))
        self.w_free_only.toggled.connect(lambda on: on and self.w_spend_all.setChecked(False))
        l_flags.addWidget(self.w_spend_all)
        self.w_claim_rewards = QCheckBox("Claim gifts && finished missions — Open Packs Only, your accounts")
        self.w_claim_rewards.setToolTip("Before opening: receive everything in the gift box (often hourglasses).\n"
                                        "After opening: claim the missions that got finished.")
        l_flags.addWidget(self.w_claim_rewards)
        self.btn_hourglasses = QPushButton("  Hourglasses list")
        self.btn_hourglasses.setIcon(icono_juego("hourglass"))
        self.btn_hourglasses.setToolTip("Hourglasses left on each of your accounts (updated while the bot runs).")
        self.btn_hourglasses.clicked.connect(self._show_hourglasses)
        l_flags.addWidget(self.btn_hourglasses)
        # CLAIM_ONLY_V1 (Ale 2026-11-15): claim on every own account even while resting, without opening packs.
        self.btn_claim_only = QPushButton("  Claim only — your accounts")
        self.btn_claim_only.setIcon(icono_juego("gift") if "gift" in ICONOS_JUEGO else QIcon())
        self.btn_claim_only.setToolTip("Logs into every one of your accounts (even the resting ones) and claims gifts,\n"
                                       "finished missions and event days. Opens no packs and doesn't touch the cooldown.")
        self.btn_claim_only.clicked.connect(self._start_claim_only)
        l_flags.addWidget(self.btn_claim_only)

        self.w_dry_run = QCheckBox("Dry run (test flow without opening packs)")
        l_flags.addWidget(self.w_dry_run)
        lay.addWidget(c_flags)

        lay.addStretch(1)
        self.tabs.addTab(page, "🎯 Farm && Pack")

    # ── TAB 2: COLLECTORS & DISCORD ────────────────────────────────
    def _build_tab_collectors(self):
        page, lay = self._make_scrollable_tab()

        c_col, l_col = self._make_card("👥 Collector Friend Codes & Live Worker")
        self.w_worker_url = QLineEdit()
        self.w_worker_url.setPlaceholderText("https://onlineids.zenithrise.workers.dev/elite")
        self.w_worker_url.setToolTip("Cloudflare Worker URL for live online collector IDs.")
        self._add_field(l_col, "Cloudflare Worker URL (Live IDs)", self.w_worker_url)

        lbl_manual = QLabel("Manual Collector IDs (16-digit friend codes or UUIDs):")
        lbl_manual.setStyleSheet(f"color: {D['TEXT2']}; font-size: 11px; padding-top: 4px;")
        l_col.addWidget(lbl_manual)

        self.w_collectors = QListWidget()
        self.w_collectors.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.w_collectors.setFixedHeight(115)
        self.w_collectors.setStyleSheet(
            f"QListWidget {{ background: {D['INPUT']}; border: 1px solid {D['BORDER']}; "
            f"border-radius: 6px; padding: 4px; color: {D['TEXT']}; }}"
            f"QListWidget::item {{ padding: 4px 6px; border-radius: 4px; }}"
            f"QListWidget::item:selected {{ background: {D['ACCENT2']}; color: white; }}"
        )
        l_col.addWidget(self.w_collectors)

        add_row = QHBoxLayout()
        add_row.setSpacing(6)
        self.w_collector_input = QLineEdit()
        self.w_collector_input.setPlaceholderText("9370-0010-9308-6237 or UUID...")
        self.w_collector_input.returnPressed.connect(self._add_collector)
        add_row.addWidget(self.w_collector_input, 1)

        self.btn_collector_add = QPushButton("+ Add")
        self.btn_collector_add.clicked.connect(self._add_collector)
        add_row.addWidget(self.btn_collector_add)

        self.btn_collector_remove = QPushButton("Remove")
        self.btn_collector_remove.clicked.connect(self._remove_selected_collectors)
        add_row.addWidget(self.btn_collector_remove)

        self.btn_collector_clear = QPushButton("Clear All")
        self.btn_collector_clear.clicked.connect(self._clear_all_collectors)
        add_row.addWidget(self.btn_collector_clear)
        l_col.addLayout(add_row)

        self.w_collectors_hint = QLabel(
            "Friend requests go to ALL listed collectors + live Worker URL. "
            "If no god pack is pulled, all links are automatically removed."
        )
        self.w_collectors_hint.setWordWrap(True)
        self.w_collectors_hint.setStyleSheet(f"color: {D['TEXT3']}; font-size: 10px;")
        l_col.addWidget(self.w_collectors_hint)
        lay.addWidget(c_col)

        c_disc, l_disc = self._make_card("🔔 Discord Webhooks & Heartbeat")
        grid_d = QGridLayout()
        grid_d.setSpacing(8)

        self.w_host_name = QLineEdit()
        self.w_host_name.setPlaceholderText("Ale Cast")
        grid_d.addWidget(self._wrap_field("Host Name (shown in Discord)", self.w_host_name), 0, 0)

        self.w_ppm_interval = NoScrollSpinBox()
        self.w_ppm_interval.setRange(1, 60)
        self.w_ppm_interval.setValue(5)
        self.w_ppm_interval.setSuffix(" min")
        grid_d.addWidget(self._wrap_field("PPM Heartbeat Interval", self.w_ppm_interval), 0, 1)
        l_disc.addLayout(grid_d)

        self.w_gp_webhook = QLineEdit()
        self.w_gp_webhook.setPlaceholderText("https://discord.com/api/webhooks/...")
        self._add_field(l_disc, "God Pack Hit Webhook URL", self.w_gp_webhook)

        self.w_ppm_webhook = QLineEdit()
        self.w_ppm_webhook.setPlaceholderText("https://discord.com/api/webhooks/... (empty = disabled)")
        self._add_field(l_disc, "PPM Status Monitor Webhook URL", self.w_ppm_webhook)

        self.w_mention_id = QLineEdit()
        self.w_mention_id.setPlaceholderText("Discord User/Role ID to ping on hit (empty = none)")
        self._add_field(l_disc, "Mention ID on God Pack Hit", self.w_mention_id)
        lay.addWidget(c_disc)

        lay.addStretch(1)
        self.tabs.addTab(page, "👥 Collectors && Discord")

    # ── TAB 3: TIMING & PROXIES ────────────────────────────────────
    def _build_tab_timing_proxy(self):
        page, lay = self._make_scrollable_tab()

        c_time, l_time = self._make_card("⚡ Concurrency, Delays & Rate Limits")
        grid_t = QGridLayout()
        grid_t.setSpacing(8)

        self.w_parallel = NoScrollSpinBox()
        self.w_parallel.setRange(1, 32)
        self.w_parallel.setValue(1)
        grid_t.addWidget(self._wrap_field("Parallel Workers", self.w_parallel), 0, 0)

        self.w_wait = NoScrollDoubleSpinBox()
        self.w_wait.setRange(0.0, 60.0)
        self.w_wait.setDecimals(1)
        self.w_wait.setValue(7.0)
        self.w_wait.setSuffix(" s")
        grid_t.addWidget(self._wrap_field("Wait After FR Send", self.w_wait), 0, 1)

        self.w_accept_timeout = NoScrollDoubleSpinBox()
        self.w_accept_timeout.setRange(0.0, 600.0)
        self.w_accept_timeout.setDecimals(1)
        self.w_accept_timeout.setSingleStep(5.0)
        self.w_accept_timeout.setValue(0.0)
        self.w_accept_timeout.setSuffix(" s")
        grid_t.addWidget(self._wrap_field("Poll Accept Timeout (0=off)", self.w_accept_timeout), 1, 0)

        self.w_cooldown = NoScrollDoubleSpinBox()
        self.w_cooldown.setRange(0.0, 168.0)   # (Arcade 2026-11-15) 0 = reopen any time (spend all hourglasses)
        self.w_cooldown.setDecimals(1)
        self.w_cooldown.setValue(24.0)
        self.w_cooldown.setSuffix(" h")
        grid_t.addWidget(self._wrap_field("Account Cooldown", self.w_cooldown), 1, 1)

        self.w_pack_delay = NoScrollDoubleSpinBox()
        self.w_pack_delay.setRange(0.5, 30.0)
        self.w_pack_delay.setDecimals(1)
        self.w_pack_delay.setSingleStep(0.5)
        self.w_pack_delay.setValue(2.0)
        self.w_pack_delay.setSuffix(" s")
        grid_t.addWidget(self._wrap_field("Delay Between Packs", self.w_pack_delay), 2, 0)

        self.w_account_delay = NoScrollDoubleSpinBox()
        self.w_account_delay.setRange(0.0, 60.0)
        self.w_account_delay.setDecimals(1)
        self.w_account_delay.setSingleStep(0.5)
        self.w_account_delay.setValue(2.0)
        self.w_account_delay.setSuffix(" s")
        grid_t.addWidget(self._wrap_field("Delay Between Accounts", self.w_account_delay), 2, 1)

        self.w_packs_per_min = NoScrollDoubleSpinBox()
        self.w_packs_per_min.setRange(0.0, 500.0)
        self.w_packs_per_min.setDecimals(0)
        self.w_packs_per_min.setValue(55.0)
        grid_t.addWidget(self._wrap_field("Packs/min Cap (per collector)", self.w_packs_per_min), 3, 0)

        self.w_fr_per_min = NoScrollDoubleSpinBox()
        self.w_fr_per_min.setRange(0.0, 300.0)
        self.w_fr_per_min.setDecimals(0)
        self.w_fr_per_min.setValue(58.0)
        grid_t.addWidget(self._wrap_field("Max FR/min (per collector)", self.w_fr_per_min), 3, 1)

        self.w_limit = NoScrollSpinBox()
        self.w_limit.setRange(0, 100000)
        self.w_limit.setValue(0)
        grid_t.addWidget(self._wrap_field("Max Accounts Limit (0=all)", self.w_limit), 4, 0)

        self.w_stop_after_fails = NoScrollSpinBox()
        self.w_stop_after_fails.setRange(0, 10000)
        self.w_stop_after_fails.setValue(0)
        grid_t.addWidget(self._wrap_field("Auto-Stop After N Fails", self.w_stop_after_fails), 4, 1)

        l_time.addLayout(grid_t)

        self.w_sort_order = NoScrollComboBox()
        self.w_sort_order.addItem("Filename (alphabetical, default)", "filename")
        self.w_sort_order.addItem("Oldest first (longest since last pack)", "oldest")
        self.w_sort_order.addItem("Newest first (most recently drained)", "newest")
        self._add_field(l_time, "Account Processing Order", self.w_sort_order)
        lay.addWidget(c_time)

        c_prox, l_prox = self._make_card("🌐 Proxy Pool & Health Checks")
        self.w_proxy_file = QLineEdit("proxies.txt")
        self._add_path_field(l_prox, "Proxy List File", self.w_proxy_file,
                             is_file=True, dialog_title="Select proxy list file")

        grid_pr = QGridLayout()
        grid_pr.setSpacing(8)

        self.w_proxy_scheme = NoScrollComboBox()
        self.w_proxy_scheme.addItems(["http", "https", "socks5"])
        grid_pr.addWidget(self._wrap_field("Proxy Scheme", self.w_proxy_scheme), 0, 0)

        self.w_proxy_rotations = NoScrollSpinBox()
        self.w_proxy_rotations.setRange(1, 20)
        self.w_proxy_rotations.setValue(3)
        grid_pr.addWidget(self._wrap_field("Max Proxies Tried / Account", self.w_proxy_rotations), 0, 1)

        self.w_proxy_checks = NoScrollSpinBox()
        self.w_proxy_checks.setRange(1, 10)
        self.w_proxy_checks.setValue(3)
        grid_pr.addWidget(self._wrap_field("Health Checks Before Dead", self.w_proxy_checks), 1, 0)

        self.w_proxy_check_gap = NoScrollDoubleSpinBox()
        self.w_proxy_check_gap.setRange(0.0, 30.0)
        self.w_proxy_check_gap.setDecimals(1)
        self.w_proxy_check_gap.setSingleStep(0.5)
        self.w_proxy_check_gap.setValue(2.0)
        self.w_proxy_check_gap.setSuffix(" s")
        grid_pr.addWidget(self._wrap_field("Gap Between Checks", self.w_proxy_check_gap), 1, 1)

        self.w_proxy_revive = NoScrollSpinBox()
        self.w_proxy_revive.setRange(0, 86400)
        self.w_proxy_revive.setValue(300)
        self.w_proxy_revive.setSuffix(" s")
        grid_pr.addWidget(self._wrap_field("Revive Dead Proxy After", self.w_proxy_revive), 2, 0, 1, 2)

        l_prox.addLayout(grid_pr)

        self.w_shuffle_proxies = QCheckBox("Shuffle proxy pool order on startup")
        self.w_shuffle_proxies.setChecked(True)
        l_prox.addWidget(self.w_shuffle_proxies)
        lay.addWidget(c_prox)

        lay.addStretch(1)
        self.tabs.addTab(page, "⚡ Timing && Proxies")

    # ── TAB 4: PATHS & SAFETY ──────────────────────────────────────
    def _build_tab_paths_safety(self):
        page, lay = self._make_scrollable_tab()

        c_dir, l_dir = self._make_card("📂 Account Credential Directories")
        self.w_xml_dir = QLineEdit("")
        self.w_xml_dir.setPlaceholderText("(optional) leave blank to use Fallback Accounts dir")
        self._add_path_field(l_dir, "XML Directory (searched recursively)", self.w_xml_dir,
                             dialog_title="Select XML folder")

        self.w_json_dir = QLineEdit("")
        self.w_json_dir.setPlaceholderText("(optional) leave blank to use Fallback Accounts dir")
        self._add_path_field(l_dir, "JSON Directory (matched by basename or deviceAccount)", self.w_json_dir,
                             dialog_title="Select JSON folder")

        self.w_accounts_dir = QLineEdit(str(ROOT / "accounts"))
        self._add_path_field(l_dir, "Fallback Accounts Directory (when XML/JSON blank)",
                             self.w_accounts_dir, dialog_title="Select fallback accounts folder")

        self.w_paths_hint = QLabel(
            "When XML/JSON dirs are set, XML dir is scanned recursively and matched to JSONs automatically."
        )
        self.w_paths_hint.setWordWrap(True)
        self.w_paths_hint.setStyleSheet(f"color: {D['TEXT3']}; font-size: 10px;")
        l_dir.addWidget(self.w_paths_hint)
        lay.addWidget(c_dir)

        c_like, l_like = self._make_card("❤️ Showcase Collection Likes")
        self.w_send_likes = QCheckBox("Send collection likes (first 5 accounts, once per 24h cycle)")
        self.w_send_likes.setChecked(False)
        l_like.addWidget(self.w_send_likes)

        self.w_like_file = QLineEdit("like_targets.txt")
        self._add_path_field(l_like, "Like Targets File", self.w_like_file,
                             is_file=True, dialog_title="Select like targets file")

        self.btn_open_like_file = QPushButton("📝 Open / Edit Like Targets File")
        self.btn_open_like_file.clicked.connect(self._open_like_file)
        l_like.addWidget(self.btn_open_like_file)
        lay.addWidget(c_like)

        c_safe, l_safe = self._make_card("🛡️ Safety, Popups & Quarantine")
        self.w_dismiss_popups = QCheckBox("Dismiss welcome-back / 60HG popups on old accounts (recommended)")
        self.w_dismiss_popups.setChecked(True)
        l_safe.addWidget(self.w_dismiss_popups)

        self.w_quarantine_locked = QCheckBox("Quarantine locked/banned accounts (moves to QUARANTINE/ folder)")
        self.w_quarantine_locked.setChecked(True)
        l_safe.addWidget(self.w_quarantine_locked)

        self.w_verify_power = QCheckBox("Verify pack power with server before sending FR")
        l_safe.addWidget(self.w_verify_power)
        lay.addWidget(c_safe)

        lay.addStretch(1)
        self.tabs.addTab(page, "📂 Paths && Safety")

    # ── UI HELPERS ─────────────────────────────────────────────────
    def _make_scrollable_tab(self) -> tuple[QScrollArea, QVBoxLayout]:
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        scroll.setStyleSheet("QScrollArea { background: transparent; border: none; }")
        container = QWidget()
        layout = QVBoxLayout(container)
        layout.setContentsMargins(10, 10, 10, 10)
        layout.setSpacing(10)
        scroll.setWidget(container)
        return scroll, layout

    def _make_card(self, title: str) -> tuple[QFrame, QVBoxLayout]:
        card = QFrame(objectName="subCard")
        vbox = QVBoxLayout(card)
        vbox.setContentsMargins(12, 10, 12, 12)
        vbox.setSpacing(6)
        lbl = QLabel(title)
        lbl.setObjectName("cardTitle")
        vbox.addWidget(lbl)
        return card, vbox

    def _create_stat_card(self, title: str, initial_value: str, accent_color: str) -> QFrame:
        card = QFrame(objectName="statCard")
        vbox = QVBoxLayout(card)
        vbox.setContentsMargins(12, 8, 12, 8)
        vbox.setSpacing(2)
        lbl_t = QLabel(title)
        lbl_t.setStyleSheet(f"color: {D['TEXT2']}; font-size: 10px; font-weight: 800; letter-spacing: 0.8px;")
        lbl_v = QLabel(initial_value)
        lbl_v.setStyleSheet(f"color: {accent_color}; font-size: 18px; font-weight: 900;")
        vbox.addWidget(lbl_t)
        vbox.addWidget(lbl_v)
        card._val_label = lbl_v
        return card

    def _wrap_field(self, label_text: str, widget: QWidget) -> QWidget:
        w = QWidget()
        v = QVBoxLayout(w)
        v.setContentsMargins(0, 0, 0, 0)
        v.setSpacing(2)
        lbl = QLabel(label_text)
        lbl.setStyleSheet(f"color: {D['TEXT2']}; font-size: 11px;")
        v.addWidget(lbl)
        v.addWidget(widget)
        return w

    def _add_field(self, layout, label_text, widget):
        if label_text:
            layout.addWidget(self._wrap_field(label_text, widget))
        else:
            layout.addWidget(widget)

    def _add_path_field(self, layout, label_text, widget, is_file=False, dialog_title=""):
        row = QVBoxLayout()
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(2)
        lbl = QLabel(label_text)
        lbl.setStyleSheet(f"color: {D['TEXT2']}; font-size: 11px;")
        row.addWidget(lbl)

        h = QHBoxLayout()
        h.setContentsMargins(0, 0, 0, 0)
        h.setSpacing(6)
        h.addWidget(widget, 1)
        browse = QPushButton("📁")
        browse.setFixedWidth(34)
        browse.setFixedHeight(28)
        browse.setToolTip(f"Browse for {label_text}")
        browse.setCursor(Qt.PointingHandCursor)

        title = dialog_title or f"Select {label_text}"

        def _on_browse():
            current = widget.text().strip()
            if current:
                p = Path(current)
                start = str(p if p.is_dir() else (p.parent if p.parent.exists() else ROOT))
            else:
                start = str(ROOT)
            if is_file:
                chosen, _ = QFileDialog.getOpenFileName(self, title, start)
            else:
                chosen = QFileDialog.getExistingDirectory(self, title, start)
            if chosen:
                widget.setText(str(Path(chosen)))

        browse.clicked.connect(_on_browse)
        h.addWidget(browse)
        row.addLayout(h)

        w = QWidget()
        w.setLayout(row)
        layout.addWidget(w)

    def _update_version_label(self):
        try:
            st = json.loads((ROOT / "reports" / "monitor_version.json").read_text("utf-8"))
        except Exception:
            self.lbl_version.setText("Monitor Pokemon: version unknown (bot not running?)")
            return
        ver = str(st.get("version") or "?")
        if self._version_al_abrir is None:
            self._version_al_abrir = ver
        if ver != self._version_al_abrir:
            txt, color = f"⚠️ Monitor Pokemon updated to v{ver} — close and reopen this window", D.get("GOLD", "#f5c542")
        elif st.get("upToDate") is True:
            txt, color = f"✅ Monitor Pokemon v{ver} — up to date", D.get("GREEN", "#34d399")
        elif st.get("upToDate") is False:
            txt, color = f"⏳ Monitor Pokemon v{ver} — updating to v{st.get('latest')}…", D.get("GOLD", "#f5c542")
        else:
            txt, color = f"Monitor Pokemon v{ver}", D["TEXT3"]
        self.lbl_version.setText(txt)
        self.lbl_version.setStyleSheet(f"color: {color}; font-size: 10px; font-weight: 700;")

    def _apply_lang(self):
        self.btn_lang.setText("EN" if self._lang == "es" else "ES")
        self.btn_lang.setToolTip("Switch to English" if self._lang == "es" else "Cambiar a español")
        traducir_ventana(self, self._lang)

    def _toggle_lang(self):
        self._lang = "en" if self._lang == "es" else "es"
        try:
            LANG_FILE.parent.mkdir(parents=True, exist_ok=True)
            LANG_FILE.write_text(self._lang, "utf-8")
        except Exception:
            pass
        self._apply_lang()

    def _set_badge(self, text: str, color: str):
        self.badge_status.setText(f"● {text}")
        self.badge_status.setStyleSheet(
            f"background: {D['CARD']}; color: {color}; border: 1px solid {color}; "
            f"border-radius: 11px; padding: 4px 12px; font-size: 11px; font-weight: 800;"
        )

    # ── Collector list management ─────────────────────────────────
    def _collectors_list(self) -> list[str]:
        return [self.w_collectors.item(i).text()
                for i in range(self.w_collectors.count())]

    def _normalize_code(self, raw: str) -> str:
        s = (raw or "").strip()
        if not s:
            return ""
        uuid_re = re.compile(
            r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
            re.IGNORECASE,
        )
        if uuid_re.match(s):
            return s.lower()
        digits = "".join(c for c in s if c.isdigit())
        if len(digits) == 16:
            return f"{digits[:4]}-{digits[4:8]}-{digits[8:12]}-{digits[12:16]}"
        return ""

    def _add_collector(self):
        raw = self.w_collector_input.text().strip()
        code = self._normalize_code(raw)
        if not code:
            QMessageBox.warning(
                self, "Invalid code",
                "Enter a 16-digit friend code (dashed or raw) or a UUID player_id.",
            )
            return
        existing = set(self._collectors_list())
        if code in existing:
            self.status_label.setText(f"Already in list: {code}")
            self.w_collector_input.clear()
            return
        self.w_collectors.addItem(QListWidgetItem(code))
        self.w_collector_input.clear()
        self._save_settings()
        self.status_label.setText(
            f"Added {code}. {self.w_collectors.count()} collector(s) total."
        )

    def _remove_selected_collectors(self):
        selected = self.w_collectors.selectedItems()
        if not selected:
            QMessageBox.information(
                self, "Select first",
                "Select one or more collectors from the list, then click Remove."
            )
            return
        removed = 0
        for item in selected:
            self.w_collectors.takeItem(self.w_collectors.row(item))
            removed += 1
        self._save_settings()
        self.status_label.setText(
            f"Removed {removed}. {self.w_collectors.count()} collector(s) remaining."
        )

    def _clear_all_collectors(self):
        if self.w_collectors.count() == 0:
            return
        self.w_collectors.clear()
        self._save_settings()
        self.status_label.setText("Cleared all manual collector codes.")

    # ── Settings load/save ────────────────────────────────────────
    def _load_settings(self):
        try:
            if SETTINGS_FILE.is_file():
                data = json.loads(SETTINGS_FILE.read_text("utf-8"))
                self.w_collectors.clear()
                codes = data.get("collectors")
                if isinstance(codes, list):
                    for c in codes:
                        norm = self._normalize_code(str(c))
                        if norm:
                            self.w_collectors.addItem(QListWidgetItem(norm))
                elif "friend_code" in data:
                    norm = self._normalize_code(str(data.get("friend_code", "")))
                    if norm:
                        self.w_collectors.addItem(QListWidgetItem(norm))
                pack_id = data.get("pack_id", DEFAULT_PAID_PACK_ID)
                idx = self.w_pack.findData(pack_id)
                if idx >= 0:
                    self.w_pack.setCurrentIndex(idx)
                self.w_packs.setValue(int(data.get("packs", 2)))
                self.w_wait.setValue(float(data.get("wait_accept", 7.0)))
                self.w_cooldown.setValue(float(data.get("cooldown_hours", 24.0)))
                self.w_pack_delay.setValue(float(data.get("pack_delay", 2.0)))
                self.w_account_delay.setValue(float(data.get("account_delay", 2.0)))
                self.w_parallel.setValue(int(data.get("parallel", 1)))
                self.w_limit.setValue(int(data.get("limit", 0)))
                so = str(data.get("sort_order", "filename"))
                si = self.w_sort_order.findData(so)
                if si >= 0:
                    self.w_sort_order.setCurrentIndex(si)
                self.w_proxy_file.setText(data.get("proxy_file", "proxies.txt"))
                self.w_proxy_scheme.setCurrentText(data.get("proxy_scheme", "http"))
                self.w_accounts_dir.setText(data.get("accounts_dir", str(ROOT / "accounts")))
                self.w_xml_dir.setText(data.get("xml_dir", ""))
                self.w_json_dir.setText(data.get("json_dir", ""))
                self.w_worker_url.setText(data.get("worker_url", "https://onlineids.zenithrise.workers.dev/elite"))
                self.w_host_name.setText(data.get("host_name", ""))
                self.w_gp_webhook.setText(data.get("gp_webhook", ""))
                self.w_ppm_webhook.setText(data.get("ppm_webhook", ""))
                self.w_mention_id.setText(data.get("mention_id", ""))
                self.w_ppm_interval.setValue(int(data.get("ppm_interval", 5)))
                self.w_dry_run.setChecked(bool(data.get("dry_run", False)))
                self.w_verify_power.setChecked(bool(data.get("verify_power", False)))
                self.w_quarantine_locked.setChecked(bool(data.get("quarantine_locked", True)))
                self.w_send_likes.setChecked(bool(data.get("send_likes", False)))
                self.w_like_file.setText(data.get("like_codes_file", "like_targets.txt"))
                self.w_dismiss_popups.setChecked(bool(data.get("dismiss_popups", True)))
                self.w_min_hourglass.setValue(int(data.get("min_hourglass", 0) or 0))
                self.w_free_only.setChecked(bool(data.get("free_only", False)))
                self.w_community.setChecked(bool(data.get("community_farm", True)))
                self.w_fr_per_min.setValue(float(data.get("fr_per_min", 58.0)))
                self.w_packs_per_min.setValue(float(data.get("packs_per_min", 55.0)))
                self.w_shuffle_proxies.setChecked(bool(data.get("shuffle_proxies", True)))
                self.w_proxy_revive.setValue(int(data.get("proxy_revive_seconds", 300) or 0))
                self.w_proxy_checks.setValue(int(data.get("proxy_checks", 3) or 3))
                self.w_proxy_check_gap.setValue(float(data.get("proxy_check_gap", 2.0)))
                self.w_proxy_rotations.setValue(int(data.get("proxy_rotations", 3) or 3))
                self.w_accept_timeout.setValue(float(data.get("accept_timeout", 0.0)))
                self.w_stop_after_fails.setValue(int(data.get("stop_after_fails", 0)))
                mode = str(data.get("run_mode", "godpack"))
                mi = self.w_run_mode.findData(mode)
                self._mode_timing = data.get("mode_timing") if isinstance(data.get("mode_timing"), dict) else {}
                self._timing_mode = None   # loading: the saved values stay as they are
                if mi >= 0:
                    self.w_run_mode.setCurrentIndex(mi)
                self._timing_mode = self.w_run_mode.currentData() or "godpack"
                fm = str(data.get("farming_mode", "only_gp"))
                fi = self.w_farming_mode.findData(fm)
                if fi >= 0:
                    self.w_farming_mode.setCurrentIndex(fi)
                pp = str(data.get("pack_power_min", "1/5"))
                pi = self.w_pack_power_min.findData(pp)
                if pi >= 0:
                    self.w_pack_power_min.setCurrentIndex(pi)
                self.w_verbose.setChecked(bool(data.get("verbose", False)))
                self.w_spend_all.setChecked(bool(data.get("spend_all_hourglasses", False)))
                self.w_claim_rewards.setChecked(bool(data.get("claim_rewards", False)))
                marcados = data.get("pack_ids")
                if isinstance(marcados, list) and marcados:
                    for i in range(self.w_pack_multi.count()):
                        it = self.w_pack_multi.item(i)
                        it.setCheckState(Qt.Checked if str(it.data(Qt.UserRole)) in marcados else Qt.Unchecked)
                self._update_mode_enabled()
        except Exception:
            pass
        if not getattr(self, "_timing_mode", None):
            self._timing_mode = self.w_run_mode.currentData() or "godpack"

    def _save_settings(self):
        data = {
            "collectors": self._collectors_list(),
            "pack_id": self.w_pack.currentData(),
            "pack_ids": self._packs_ticked(),   # Open Packs Only: several packs, the accounts take turns
            "spend_all_hourglasses": self.w_spend_all.isChecked(),
            "claim_rewards": self.w_claim_rewards.isChecked(),
            "packs": self.w_packs.value(),
            "wait_accept": self.w_wait.value(),
            "cooldown_hours": self.w_cooldown.value(),
            "pack_delay": self.w_pack_delay.value(),
            "account_delay": self.w_account_delay.value(),
            "parallel": self.w_parallel.value(),
            "limit": self.w_limit.value(),
            "sort_order": self.w_sort_order.currentData() or "filename",
            "proxy_file": self.w_proxy_file.text().strip(),
            "proxy_scheme": self.w_proxy_scheme.currentText(),
            "accounts_dir": self.w_accounts_dir.text().strip(),
            "xml_dir": self.w_xml_dir.text().strip(),
            "json_dir": self.w_json_dir.text().strip(),
            "worker_url": self.w_worker_url.text().strip(),
            "host_name": self.w_host_name.text().strip(),
            "gp_webhook": self.w_gp_webhook.text().strip(),
            "ppm_webhook": self.w_ppm_webhook.text().strip(),
            "mention_id": self.w_mention_id.text().strip(),
            "ppm_interval": self.w_ppm_interval.value(),
            "dry_run": self.w_dry_run.isChecked(),
            "verify_power": self.w_verify_power.isChecked(),
            "quarantine_locked": self.w_quarantine_locked.isChecked(),
            "send_likes": self.w_send_likes.isChecked(),
            "like_codes_file": self.w_like_file.text().strip(),
            "dismiss_popups": self.w_dismiss_popups.isChecked(),
            "min_hourglass": self.w_min_hourglass.value(),
            "free_only": self.w_free_only.isChecked(),
            "community_farm": self.w_community.isChecked(),
            "fr_per_min": self.w_fr_per_min.value(),
            "packs_per_min": self.w_packs_per_min.value(),
            "shuffle_proxies": self.w_shuffle_proxies.isChecked(),
            "proxy_revive_seconds": self.w_proxy_revive.value(),
            "proxy_checks": self.w_proxy_checks.value(),
            "proxy_check_gap": self.w_proxy_check_gap.value(),
            "proxy_rotations": self.w_proxy_rotations.value(),
            "accept_timeout": self.w_accept_timeout.value(),
            "stop_after_fails": self.w_stop_after_fails.value(),
            "run_mode": self.w_run_mode.currentData() or "godpack",
            "farming_mode": self.w_farming_mode.currentData() or "only_gp",
            "pack_power_min": self.w_pack_power_min.currentData() or "1/5",
            "verbose": self.w_verbose.isChecked(),
            "mode_timing": self._remember_mode_timing(),
        }
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        try:
            SETTINGS_FILE.write_text(json.dumps(data, indent=2), "utf-8")
            if not self.status_label.text().startswith(("Added", "Removed", "Already", "Cleared")):
                self.status_label.setText(f"Settings saved to {SETTINGS_FILE.name}.")
        except Exception as exc:
            QMessageBox.warning(self, "Save failed", str(exc))

    # ── Injection subprocess ──────────────────────────────────────
    def _build_cmd(self) -> list[str]:
        run_mode = self.w_run_mode.currentData() or "godpack"
        codes = self._collectors_list()
        worker_url = self.w_worker_url.text().strip()
        if run_mode == "godpack" and not codes and not worker_url:
            QMessageBox.warning(
                self, "No collectors",
                "Add at least one collector friend code or a Worker URL, "
                "or switch Run mode to 'Open Packs Only'.",
            )
            return []
        if run_mode == "packs-only" and not self._packs_ticked():
            QMessageBox.warning(self, "No pack", "Tick at least one pack in 'Packs to Open'.")
            return []
        sobres = self._packs_for_run()
        pack_id = sobres[0]
        product_id = product_id_for_pack(pack_id)
        cmd = [
            sys.executable, str(INJECT_SCRIPT),
            "--collector-codes", ",".join(codes) if codes else "dummy",
            "--worker-url", worker_url,
            "--packs", str(packs_for(pack_id, self.w_packs.value())),
            "--pack-id", pack_id,
            "--product-id", product_id,
            "--accounts-dir", self.w_accounts_dir.text().strip(),
            "--xml-dir", self.w_xml_dir.text().strip(),
            "--json-dir", self.w_json_dir.text().strip(),
            "--proxy-file", self.w_proxy_file.text().strip(),
            "--proxy-scheme", self.w_proxy_scheme.currentText(),
            "--cooldown-hours", str(self.w_cooldown.value()),
            "--wait-accept", str(self.w_wait.value()),
            "--pack-delay", str(self.w_pack_delay.value()),
            "--account-delay", str(self.w_account_delay.value()),
            "--parallel", str(self.w_parallel.value()),
            "--limit", str(self.w_limit.value()),
            "--sort-order", self.w_sort_order.currentData() or "filename",
            "--mode", run_mode,
            "--farming-mode", self.w_farming_mode.currentData() or "only_gp",
            "--pack-power-min", self.w_pack_power_min.currentData() or "1/5",
        ]
        # 2026-11-07 (Ale): with Community farm, the host's OWN accounts follow the Run Mode like the lent ones:
        # God Pack opens only GP-eligible accounts, Open Packs Only only the locked ones (still missing packs).
        try:
            inject_ok = "--gp-eligibility" in Path(INJECT_SCRIPT).read_text("utf-8", errors="ignore")
        except Exception:
            inject_ok = False
        if inject_ok and self.w_community.isChecked():
            cmd += ["--gp-eligibility", "locked" if run_mode == "packs-only" else "eligible"]
        try:
            _inj = Path(INJECT_SCRIPT).read_text("utf-8", errors="ignore")
        except Exception:
            _inj = ""
        if "--track-hourglasses" in _inj:   # own accounts only: this process never opens lent ones
            cmd.append("--track-hourglasses")
            if self.w_spend_all.isChecked() and run_mode == "packs-only":
                cmd.append("--spend-all-hourglasses")
            if self.w_claim_rewards.isChecked():
                cmd.append("--claim-rewards")
        if len(sobres) > 1:
            cmd += ["--pack-rotation", ",".join(
                f"{p}:{product_id_for_pack(p)}:{packs_for(p, self.w_packs.value())}" for p in sobres)]
        if self.w_dry_run.isChecked():
            cmd.append("--dry-run")
        if self.w_verify_power.isChecked():
            cmd.append("--verify-power")
        if self.w_quarantine_locked.isChecked():
            cmd.append("--quarantine-locked")
        else:
            cmd.append("--no-quarantine-locked")
        if self.w_send_likes.isChecked():
            cmd.append("--send-likes")
            cmd += ["--like-codes-file",
                    self.w_like_file.text().strip() or "like_targets.txt"]
        if self.w_dismiss_popups.isChecked():
            cmd.append("--dismiss-popups")
        else:
            cmd.append("--no-dismiss-popups")
        if self.w_min_hourglass.value() > 0:
            cmd += ["--min-hourglass", str(self.w_min_hourglass.value())]
        if self.w_free_only.isChecked():
            cmd += ["--hg-cost", "0"]
        cmd.extend(["--fr-per-min", str(self.w_fr_per_min.value())])
        ppm = float(self.w_packs_per_min.value())
        if ppm > 0:
            cmd.extend(["--packs-per-min", str(ppm)])
        if self.w_shuffle_proxies.isChecked():
            cmd.append("--shuffle-proxies")
        cmd.extend(["--proxy-revive-seconds", str(self.w_proxy_revive.value())])
        cmd.extend(["--proxy-checks", str(self.w_proxy_checks.value())])
        cmd.extend(["--proxy-check-gap", str(self.w_proxy_check_gap.value())])
        cmd.extend(["--proxy-rotations", str(self.w_proxy_rotations.value())])
        cmd.extend(["--accept-timeout", str(self.w_accept_timeout.value())])
        cmd.extend(["--stop-after-fails", str(self.w_stop_after_fails.value())])
        return cmd

    def _open_like_file(self):
        raw = self.w_like_file.text().strip() or "like_targets.txt"
        p = Path(raw).expanduser()
        if not p.is_absolute():
            p = ROOT / p
        try:
            if not p.exists():
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(
                    "# Friend codes to LIKE - one per line (16 digits, dashed or raw).\n"
                    "# Separate from the god-pack collectors. '#' starts a comment.\n",
                    encoding="utf-8")
            QDesktopServices.openUrl(QUrl.fromLocalFile(str(p)))
        except Exception as exc:
            QMessageBox.warning(self, "Like targets file", str(exc))

    # Ale 2026-11-09: each Run Mode keeps its own speed settings. Open Packs Only sends no friend requests
    # (no Mains, no 40 PPM cap), so the first time it starts at Parallel 15 / 1 s / 2 s (~120 PPM, Ale);
    # God Pack mode gets back the values it had. Values changed by hand are remembered per mode.
    MODE_TIMING_DEFAULTS = {"packs-only": {"parallel": 15, "account_delay": 1.0, "pack_delay": 2.0}}

    def _remember_mode_timing(self) -> dict:
        tabla = getattr(self, "_mode_timing", None)
        if not isinstance(tabla, dict):
            tabla = self._mode_timing = {}
        modo = getattr(self, "_timing_mode", None)
        if modo:
            tabla[modo] = {"parallel": self.w_parallel.value(),
                           "account_delay": self.w_account_delay.value(),
                           "pack_delay": self.w_pack_delay.value()}
        return tabla

    def _apply_mode_timing(self):
        nuevo = self.w_run_mode.currentData() or "godpack"
        anterior = getattr(self, "_timing_mode", None)
        if anterior is None or anterior == nuevo:   # still loading the settings
            return
        tabla = self._remember_mode_timing()          # keep the values of the mode being left
        self._timing_mode = nuevo
        valores = tabla.get(nuevo) or self.MODE_TIMING_DEFAULTS.get(nuevo)
        if not valores:
            return
        self.w_parallel.setValue(int(valores.get("parallel", self.w_parallel.value())))
        self.w_account_delay.setValue(float(valores.get("account_delay", self.w_account_delay.value())))
        self.w_pack_delay.setValue(float(valores.get("pack_delay", self.w_pack_delay.value())))
        self.status_label.setText(
            f"Speed set for {'Open Packs Only' if nuevo == 'packs-only' else 'God Pack'}: "
            f"Parallel {self.w_parallel.value()} · {self.w_account_delay.value():.1f}s between accounts "
            f"· {self.w_pack_delay.value():.1f}s between packs (Timing tab).")

    def _update_mode_enabled(self):
        try:
            is_gp = (self.w_run_mode.currentData() or "godpack") == "godpack"
        except Exception:
            is_gp = True
        for w in (self.w_farming_mode, self.w_pack_power_min,
                  self.w_collectors, self.w_wait, self.w_fr_per_min,
                  self.w_verify_power):
            try:
                w.setEnabled(is_gp)
            except Exception:
                pass
        # God Pack: one pack (combo). Open Packs Only: tick several (list).
        try:
            self._pack_one_field.setVisible(is_gp)
            self._pack_multi_field.setVisible(not is_gp)
            self.w_pack_multi_hint.setVisible(not is_gp)
            self._update_pack_multi_hint()
        except Exception:
            pass

    def _packs_ticked(self) -> list[str]:
        """Pack ids ticked in the Open Packs Only list (in list order)."""
        out = []
        try:
            for i in range(self.w_pack_multi.count()):
                it = self.w_pack_multi.item(i)
                if it.checkState() == Qt.Checked:
                    out.append(str(it.data(Qt.UserRole)))
        except Exception:
            pass
        return out

    def _packs_for_run(self) -> list[str]:
        """Packs this run opens: the ticked ones in Open Packs Only, else the combo's one."""
        if (self.w_run_mode.currentData() or "godpack") == "packs-only":
            ticked = self._packs_ticked()
            if ticked:
                return ticked
        return [self.w_pack.currentData() or DEFAULT_PAID_PACK_ID]

    def _update_pack_multi_hint(self):
        try:
            n = len(self._packs_ticked())
            self.w_pack_multi_hint.setText(
                "Tick at least one pack." if n == 0 else
                "1 pack: every account opens it." if n == 1 else
                f"{n} packs: account 1 opens the 1st, account 2 the 2nd, ... and it starts over.")
        except Exception:
            pass

    # ── Hourglasses list (Ale 2026-11-12) ─────────────────────────
    def _hourglasses_html(self) -> str:
        try:
            data = json.loads((ROOT / "reports" / "hourglasses.json").read_text("utf-8"))
        except Exception:
            data = {}
        filas = sorted(data.values(), key=lambda v: -int(v.get("hg", 0)))
        total = sum(int(v.get("hg", 0)) for v in filas)
        gastado = sum(max(0, int(v.get("before", 0)) - int(v.get("hg", 0))) for v in filas if int(v.get("before", -1)) >= 0)
        def hace(ts):
            m = max(0, int((time.time() - int(ts or 0)) // 60))
            return f"{m} min ago" if m < 60 else f"{m // 60} h ago" if m < 2880 else f"{m // 1440} d ago"
        cab = (f"<div style='font-size:15px;margin-bottom:6px'><b>Total: {total:,} LARGE</b> on {len(filas)} account(s)"
               f" &nbsp;·&nbsp; spent last time: {gastado:,} &nbsp;·&nbsp; packs they can still pay: {total // 12:,}</div>")
        if not filas:
            return cab + "<p>No data yet: it fills in while the bot opens your accounts.</p>"
        tr = "".join(
            f"<tr><td>{_html.escape(str(v.get('name', '?')))}</td><td align='right'><b>{int(v.get('hg', 0)):,}</b></td>"
            f"<td align='right'>{int(v.get('before', -1)) if int(v.get('before', -1)) >= 0 else '—'}</td>"
            f"<td align='right'>{int(v.get('packs', 0))}</td><td>{hace(v.get('ts'))}</td></tr>" for v in filas[:2000])
        return (cab + "<table cellspacing='0' cellpadding='4' width='100%'>"
                "<tr><th align='left'>Account</th><th align='right'>Hourglasses</th><th align='right'>Before</th>"
                "<th align='right'>Packs</th><th align='left'>Seen</th></tr>" + tr + "</table>")

    def _start_claim_only(self):
        try:
            inj = Path(INJECT_SCRIPT).read_text("utf-8", errors="ignore")
        except Exception:
            inj = ""
        if "--claim-only" not in inj:
            QMessageBox.information(self, "Update needed", "The engine doesn't have 'Claim only' yet: restart the bot so it installs it.")
            return
        cmd = self._build_cmd()
        if not cmd:
            return
        cmd = [c for c in cmd if c not in ("--spend-all-hourglasses",)] + ["--claim-only"]
        self._start_injection(cmd_override=cmd)

    def _show_hourglasses(self):
        dlg = QDialog(self)
        dlg.setWindowTitle("Hourglasses - your accounts")
        dlg.resize(620, 560)
        v = QVBoxLayout(dlg)
        vista = QTextEdit()
        vista.setReadOnly(True)
        vista.setStyleSheet(f"background: {D['INPUT']}; color: {D['TEXT']}; border: 1px solid {D['BORDER']};")
        vista.setHtml(self._hourglasses_html())
        v.addWidget(vista)
        nota = QLabel("Updated every 5 s while the bot runs. History: reports/hourglasses_history.jsonl")
        nota.setStyleSheet(f"color: {D['TEXT2']}; font-size: 11px;")
        v.addWidget(nota)
        reloj = QTimer(dlg)
        def refrescar():
            pos = vista.verticalScrollBar().value()
            vista.setHtml(self._hourglasses_html())
            vista.verticalScrollBar().setValue(pos)
        reloj.timeout.connect(refrescar)
        reloj.start(5000)
        dlg.show()

    # FARM96_WINDOW_V1: members' /farm (Monitor Pokemon writes it to reports/farm96.log, apart from the GP farm).
    FARM96_LOG = ROOT / "reports" / "farm96.log"
    FARM96_JOBS = {"open96": "Farm 96P", "open2": "Open 2 packs", "special": "Special pack", "claim": "Claim gifts"}

    def _farm96_read(self) -> tuple[str, list[str]]:
        """(summary html, last log lines) from the end of farm96.log."""
        try:
            with open(self.FARM96_LOG, "rb") as f:
                f.seek(0, 2)
                f.seek(max(0, f.tell() - 3 * 1024 * 1024))
                lineas = f.read().decode("utf-8", errors="replace").splitlines()
            # Readable and safe: no request headers, proxy passwords masked.
            lineas = [re.sub(r"//[^/@\s]+@", "//***@", l) for l in lineas
                      if l.strip() and "x-takasho" not in l and "DIAG-META" not in l and "x-grpc" not in l and "x-user-agent" not in l]
        except Exception:
            return ("<p>No member has used /farm on this host yet.</p>", [])
        runs = {}   # owner -> {job, start, accounts, done, packs, gifts}
        for ln in lineas:
            m = re.match(r"===== (\S+) owner=(\d+) accounts=(\d+)(?: job=(\w+))?(?:.*? name=(.+?))? =====", ln)
            if m:
                r = runs.setdefault(m.group(2), {"job": "", "start": m.group(1), "accounts": 0, "done": 0, "packs": 0, "gifts": 0, "last": m.group(1), "name": ""})
                r["job"] = m.group(4) or r["job"]
                r["name"] = (m.group(5) or "").strip() or r["name"]
                r["accounts"] += int(m.group(3))
                r["last"] = m.group(1)
                cur = r
                continue
            if not runs:
                continue
            if "gift pack opened" in ln:
                cur["gifts"] += 1
            elif "pack opened cards=" in ln:
                cur["packs"] += 1
            elif "-- ACCOUNT SUMMARY:" in ln or "claim only: done" in ln:
                cur["done"] += 1
        if not runs:
            return ("<p>No member has used /farm on this host yet.</p>", lineas[-400:])
        # /farm speed on its own (Ale 2026-11-19: "separa los ppm"): packs in the last 10 min of the log / 10.
        horas = []
        for ln in lineas:
            if "pack opened cards=" in ln and "gift pack opened" not in ln:
                mh = re.match(r"\[(\d\d):(\d\d):(\d\d)\]", ln)
                if mh:
                    horas.append(int(mh.group(1)) * 3600 + int(mh.group(2)) * 60 + int(mh.group(3)))
        ppm_farm = 0.0
        if horas:
            fin = horas[-1]
            ventana = [h for h in horas if 0 <= (fin - h) % 86400 <= 600]
            ppm_farm = len(ventana) / 10.0
        cab_ppm = (f"<p style='margin:2px 0 6px 0'><b>/farm speed: {ppm_farm:.1f} PPM</b> (last 10 min of /farm) — "
                   f"separate from your GP farm PPM, never sent to Zenith.</p>")
        filas = "".join(
            f"<tr><td><b>{_html.escape(r.get('name') or dueno)}</b></td><td>{self.FARM96_JOBS.get(r['job'], r['job'] or '?')}</td>"
            f"<td align='right'>{r['done']:,} / {r['accounts']:,}</td><td align='right'><b>{r['packs']:,}</b></td>"
            f"<td align='right'>{r['gifts']:,}</td><td>{_html.escape(r['last'][11:16])} UTC</td></tr>"
            for dueno, r in sorted(runs.items(), key=lambda kv: kv[1]["last"], reverse=True)[:15])
        cab = (cab_ppm + "<table cellspacing='0' cellpadding='4' width='100%'><tr><th align='left'>Member</th>"
               "<th align='left'>Job</th><th align='right'>Accounts</th><th align='right'>Packs</th>"
               "<th align='right'>Gift packs</th><th align='left'>Last batch</th></tr>" + filas + "</table>")
        return (cab, lineas[-400:])

    def _show_farm96(self):
        dlg = QDialog(self)
        dlg.setWindowTitle("Members' /farm on this host")
        dlg.resize(900, 640)
        v = QVBoxLayout(dlg)
        nota = QLabel("Members opening their lent accounts with /farm (only while this host has the community turn). "
                      "Not part of your GP farm or your PPM.")
        nota.setWordWrap(True)
        nota.setStyleSheet(f"color: {D['TEXT2']}; font-size: 11px;")
        v.addWidget(nota)
        resumen = QTextEdit()
        resumen.setReadOnly(True)
        resumen.setFixedHeight(150)
        resumen.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        resumen.setStyleSheet(f"background: {D['INPUT']}; color: {D['TEXT']}; border: 1px solid {D['BORDER']};")
        v.addWidget(resumen)
        log = QTextEdit()
        log.setReadOnly(True)
        log.setStyleSheet(f"background: {D['INPUT']}; color: {D['TEXT']}; border: 1px solid {D['BORDER']}; "
                          "font-family: Consolas, monospace; font-size: 11px;")
        v.addWidget(log, 1)
        estado = {"n": -1}

        def refrescar():
            cab, lineas = self._farm96_read()
            resumen.setHtml(cab)
            if len(lineas) != estado["n"] or (lineas and lineas[-1] != estado.get("u")):
                barra = log.verticalScrollBar()
                abajo = barra.value() >= barra.maximum() - 4
                log.setPlainText("\n".join(lineas))
                if abajo:
                    barra.setValue(barra.maximum())
                estado["n"], estado["u"] = len(lineas), (lineas[-1] if lineas else None)

        refrescar()
        log.verticalScrollBar().setValue(log.verticalScrollBar().maximum())
        reloj = QTimer(dlg)
        reloj.timeout.connect(refrescar)
        reloj.start(2000)
        dlg.show()

    def _update_community_hint(self, *_):
        try:
            self.w_community_hint.setText(
                "Your accounts + the community's lent accounts (counters show all)." if self.w_community.isChecked()
                else "Only your own accounts (counters show only yours).")
        except Exception:
            pass

    def _start_cleanup_only(self):
        cmd = [
            sys.executable, str(INJECT_SCRIPT), "--cleanup-only",
            "--proxy-file", self.w_proxy_file.text().strip(),
            "--proxy-scheme", self.w_proxy_scheme.currentText(),
        ]
        self._start_injection(cmd_override=cmd)

    def _start_injection(self, cmd_override=None):
        if self.proc is not None and self.proc.state() != QProcess.NotRunning:
            QMessageBox.information(self, "Already running",
                                    "An injection process is already running.")
            return
        if self._community and not getattr(self, "_rescan_propias", False):
            return
        comunidad = self.w_community.isChecked() and not isinstance(cmd_override, list)
        propias = bool(self.w_xml_dir.text().strip() or self.w_accounts_dir.text().strip())
        if comunidad and not propias:
            self._start_community(limpiar=True)
            return
        cmd = cmd_override if isinstance(cmd_override, list) else self._build_cmd()
        if not cmd:
            return
        self._save_settings()

        log_dir = ROOT / "reports"
        log_dir.mkdir(parents=True, exist_ok=True)
        log_path = log_dir / "god_pack_live.log"
        try:
            log_path.write_text("", encoding="utf-8")
        except Exception:
            pass
        cmd = cmd + ["--log-file", str(log_path)]

        stop_dir = ROOT / "reports" / "stop_requests"
        stop_dir.mkdir(parents=True, exist_ok=True)
        self._stop_f = stop_dir / f"stop_god_pack_{uuid.uuid4().hex[:8]}.txt"
        try:
            if self._stop_f.exists():
                self._stop_f.unlink()
        except Exception:
            pass
        cmd = cmd + ["--stop-file", str(self._stop_f)]

        # 2026-11-08 (Arcade): the 15-min re-check of own accounts must not wipe the session stats
        # (time, packs opened) nor the log on screen; only a real Start does.
        rescan = bool(getattr(self, "_rescan_propias", False))
        if not rescan:
            self.log_view.clear()
            self._stdout_raw_pending.clear()
            self._stdout_line_tail = ""
            self._live_tail = ""
            self._last_pack_line.clear()
            self._pending_hit_header.clear()
            self._gp_counted.clear()
            self._live = {"accounts": 0, "packs": 0, "matches": 0, "errors": 0, "t0": time.time()}
            self._log_pending = []
        self._own_total = 0; self._own_done = 0; self._own_opened = 0
        self._update_live_label(running=True)
        self._append_log(f"[gui] launching: {' '.join(cmd)}\n")
        self._append_log(f"[gui] raw log: {log_path}\n")

        if not rescan:   # the re-check doesn't pop the external log window again every 15 min
            self._spawn_powershell_tail(log_path)

        self.proc = QProcess(self)
        self.proc.setProcessChannelMode(QProcess.MergedChannels)
        env = QProcessEnvironment.systemEnvironment()
        env.insert("UTLS_PROXY", "1")
        self.proc.setProcessEnvironment(env)
        self.proc.readyReadStandardOutput.connect(self._on_stdout)
        self.proc.finished.connect(self._on_finished)
        self.proc.setWorkingDirectory(str(ROOT))
        self.proc.start(cmd[0], cmd[1:])

        self._run_id += 1
        self._stopping = False
        self.btn_start.setEnabled(False)
        self.btn_cleanup.setEnabled(False)
        self.btn_stop.setEnabled(True)
        self.btn_stop.setText("■  STOP")
        self.status_label.setText("Running injection...")
        self._set_badge("RUNNING", D["GREEN"])

        # ── PPM MONITOR THREAD ──
        from threading import Thread, Event
        from scripts.god_pack.ppm_monitor import start_ppm_loop

        current_pack_name = self.w_pack.currentText()
        interval_mins = self.w_ppm_interval.value() if hasattr(self, "w_ppm_interval") else 5

        self._save_settings()
        if getattr(self, "_ppm_stop", None) is not None:
            self._ppm_stop.set()
        self._ppm_stop = Event()
        if comunidad and not self._community:
            self._start_community(limpiar=False)
        # Ale 2026-11-12: Open Packs Only is not God Pack PPM (Arcade showed 92 PPM in LatiasBot): not reported.
        solo_sobres = (self.w_run_mode.currentData() or "godpack") == "packs-only"
        webhook_target = "" if (comunidad or solo_sobres) else self.w_ppm_webhook.text().strip()
        if webhook_target:
            Thread(target=start_ppm_loop, args=(webhook_target, current_pack_name, interval_mins,
                                                self.w_host_name.text().strip() or "Host", self._ppm_stop),
                   daemon=True).start()

    def _spawn_powershell_tail(self, log_path):
        if sys.platform != "win32":
            return
        try:
            import subprocess
            CREATE_NEW_CONSOLE = 0x00000010
            ps_cmd = (
                f"$host.UI.RawUI.WindowTitle = 'God Pack Injection - Live Log'; "
                f"Write-Host '=== tailing: {log_path} ===' -ForegroundColor Cyan; "
                f"Get-Content -Wait -Path '{log_path}'"
            )
            viejo = getattr(self, "_tail_proc", None)
            if viejo is not None and viejo.poll() is None:
                try:
                    subprocess.run(["taskkill", "/PID", str(viejo.pid), "/T", "/F"],
                                   capture_output=True, creationflags=0x08000000)
                except Exception:
                    pass
            self._tail_proc = subprocess.Popen(
                ["powershell.exe", "-NoExit", "-Command", ps_cmd],
                creationflags=CREATE_NEW_CONSOLE,
            )
        except Exception as exc:
            self._append_log(f"[gui] couldn't spawn PowerShell tail window: {exc}\n")

    STOP_SAFETY_KILL_MS = 20 * 60 * 1000

    def _stop_injection(self):
        if self._community:
            self._stop_community()
        if getattr(self, "_ppm_stop", None) is not None:
            self._ppm_stop.set()
        if self.proc is None or self.proc.state() == QProcess.NotRunning:
            return

        if self._stopping:
            self._force_kill(ask=True)
            return

        self._stopping = True
        stop_path = getattr(self, "_stop_f", None)
        try:
            stop_path.parent.mkdir(parents=True, exist_ok=True)
            stop_path.write_text("stop", encoding="utf-8")
            self._append_log(
                "[gui] stop requested - finishing current account, then "
                "sweeping ALL leftover friend requests before exit.\n")
        except Exception as exc:
            self._append_log(f"[gui] failed to write stop file: {exc}\n")

        self.btn_stop.setText("⚠ FORCE KILL")
        self.status_label.setText("Stopping — cleaning up friend requests...")
        self._set_badge("STOPPING", D["AMBER"])
        run_id = self._run_id
        QTimer.singleShot(self.STOP_SAFETY_KILL_MS,
                          lambda: self._safety_kill(run_id))

    def _safety_kill(self, run_id: int):
        if run_id == self._run_id:
            self._force_kill(ask=False)

    def _force_kill(self, ask: bool):
        if self.proc is None or self.proc.state() == QProcess.NotRunning:
            return
        if ask:
            r = QMessageBox.question(
                self, "Force kill?",
                "Cleanup is still running. Force-killing now can leave pending "
                "friend requests on collectors.\n\nThey are remembered and will "
                "be cleaned on the next Start.\n\nKill anyway?")
            if r != QMessageBox.Yes:
                return
        self.proc.kill()
        self._append_log("[gui] force-killed - leftovers stay in reports/fr_ledger.json\n")

    def closeEvent(self, event):
        if self._community:
            self._stop_community()
        if self.proc is not None and self.proc.state() != QProcess.NotRunning:
            r = QMessageBox.question(
                self, "Bot still running",
                "Stop the bot, clean up all friend requests, then close?\n\n"
                "Yes = graceful stop + cleanup, window closes when done\n"
                "No = keep running")
            if r == QMessageBox.Yes:
                self._close_after_finish = True
                if not self._stopping:
                    self._stop_injection()
            event.ignore()
            return
        event.accept()

    # ── Spanish-to-English Real-Time Log Translator ───────────────
    _SPANISH_TO_ENGLISH_RULES = [
        (re.compile(r"Contenido recibido de "), "Content received from "),
        (re.compile(r"Total IDs listos para enviar solicitud: (\d+) IDs"),
         r"Total IDs ready for friend request: \1 IDs"),
        (re.compile(r"(\d+) ID\(s\) online detectados:"),
         r"\1 online ID(s) detected:"),
        (re.compile(r"0 usuarios online en el Worker; esperando 10s\.\.\."),
         "0 online users in Worker; waiting 10s..."),
        (re.compile(r"Error leyendo lista online "), "Error reading online list "),
        (re.compile(r"Error leyendo Worker "), "Error reading Worker "),
        (re.compile(r"SendRequestsV1 ABORTED en lote (\d+)\. Servidor saturado\."),
         r"SendRequestsV1 ABORTED in batch \1. Server rate-limited."),
        (re.compile(r"SendRequestsV1 ABORTED al ID (\d+)\. Servidor saturado\."),
         r"SendRequestsV1 ABORTED at ID \1. Server rate-limited."),
        (re.compile(r"SendRequestsV1 error \(StatusCode\.ABORTED\) en el lote (\d+)\. Deteniendo envío para evitar baneo temporal\."),
         r"SendRequestsV1 error (StatusCode.ABORTED) in batch \1. Stopping send to avoid temporary ban."),
        (re.compile(r"SendRequestsV1 error \(StatusCode\.ABORTED\) al enviar al ID (\d+)\. Deteniendo envío\."),
         r"SendRequestsV1 error (StatusCode.ABORTED) at ID \1. Stopping send."),
        (re.compile(r"Error en lote de SendRequestsV1:"), "Error in SendRequestsV1 batch:"),
        (re.compile(r"Procesando sobre especial de bienvenida "),
         "Processing special welcome pack "),
        (re.compile(r"Advertencia en compra directa, intentando método alternativo:"),
         "Direct purchase warning, trying fallback method:"),
        (re.compile(r"Error enviando webhook PPM:"), "Error sending PPM webhook:"),
        (re.compile(r"Monitor PPM reanudado desde caché(?: \(<15m\))?: \+(\d+)m acumulados, \+?(\d+) packs previos\."),
         r"PPM Monitor resumed from cache: +\1m accumulated, +\2 previous packs."),
        (re.compile(r"Monitor PPM iniciado desde 0\. Enviando cada (\d+) minutos\.\.\."),
         r"PPM Monitor started from 0. Sending every \1 minutes..."),
        (re.compile(r"Monitor PPM detenido\. Caché guardado(?: por 15 minutos)?\."),
         "PPM Monitor stopped. Cache saved."),
    ]

    def _translate_to_english(self, line: str) -> str:
        """Translates any Spanish log messages from inject.py / ppm_monitor.py into English."""
        out = line
        for pattern, replacement in self._SPANISH_TO_ENGLISH_RULES:
            out = pattern.sub(replacement, out)
        return out

    # ── Explicit & Informative Filter Patterns (English) ──────────
    _GUI_LINE_PATTERNS = re.compile(
        r"("
        r"discovered: eligible="
        r"|loaded \d+ proxies"
        r"|starting: accounts="
        r"|login attempt \d+/\d+"
        r"|login OK player_id="
        r"|login failed:|login exhausted|login exception:"
        r"|\[worker-elite\] Total IDs"
        r"|\[worker-elite\] \d+ online ID\(s\) detected:"
        r"|0 online users in Worker"
        r"|collectors resolved:"
        r"|verify_power: server reports|verify_power: RPC failed"
        r"|skipping - server says 0 packs"
        r"|paid pack mix:|capping packs |\[pack \d+/\d+\] FREE"
        r"|friend requests sent to |waiting .* for accept|polling up to"
        r"|all \d+/\d+ FR\(s\) accepted|\[timeout\] no accept"
        r"|\[pack-budget\]"
        r"|pack opened cards="
        r"|cards: "
        r"|\[threshold\] "
        r"|-- ACCOUNT SUMMARY:"
        r"|\[MATCH\]|GOD PACK |god pack drawn but UNPICKABLE|<-- RARE PACK|<-- rare "
        r"|friend list check:"
        r"|no wishlist match; all \d+ collector links removed"
        r"|\[cleanup\] |\[fr-sweep\] |\[stop-signal\] |\[AUTO-STOP\]"
        r"|\[popup\] |\[hourglass\] |\[like\] |\[quarantine\] |\[sp1\] "
        r"|\[proxy\] marking current proxy unhealthy"
        r"|\[!\] |\[X\] |^Traceback"
        r"|DONE — |DONE - |• packs opened:|• cards pulled:|• Wonder-Pick god hits:"
        r"|• accounts with |├─ |└─ |pool report:"
        r")"
    )

    _CLEANUP_SPAM_PATTERNS = re.compile(
        r"(\[fr-cleanup\]|CancelSentRequestsV1|\[Friends\] ListV1|Friend/DeleteV1: unfriended)"
    )

    # ── Community farm (COMMUNITY_FARM_V1) ───────────────────────
    COMMUNITY_FILE = ROOT / "reports" / "community_farm.json"
    COMMUNITY_STOP = ROOT / "reports" / "community_farm.stop"
    COMMUNITY_LOG = ROOT / "reports" / "reroll_comunidad.log"

    def _community_mark(self, on: bool):
        try:
            self.COMMUNITY_FILE.parent.mkdir(parents=True, exist_ok=True)
            self.COMMUNITY_FILE.write_text(
                json.dumps({"on": bool(on), "ts": int(time.time() * 1000),
                            "own": int(getattr(self, "_own_count", 0)),
                            # busy = this host's OWN accounts are still being opened: the community farm
                            # waits for them (Ale 2026-11-06: own accounts first, then the lent ones).
                            "busy": bool(self.proc is not None and self.proc.state() != QProcess.NotRunning)}),
                encoding="utf-8")
        except Exception as exc:
            self._append_log(f"[gui] couldn't write {self.COMMUNITY_FILE.name}: {exc}\n")

    def _own_accounts(self) -> int:
        carpeta = self.w_xml_dir.text().strip() or self.w_accounts_dir.text().strip()
        try:
            return sum(1 for _ in Path(carpeta).rglob("*.xml")) if carpeta and Path(carpeta).is_dir() else 0
        except Exception:
            return 0

    def _start_community(self, limpiar: bool = True):
        self._save_settings()
        self._own_count = self._own_accounts()
        try:
            if self.COMMUNITY_STOP.exists():
                self.COMMUNITY_STOP.unlink()
        except Exception:
            pass
        self._community = True
        self._community_mark(True)
        try:
            self._community_pos = self.COMMUNITY_LOG.stat().st_size
        except Exception:
            self._community_pos = 0
        if limpiar:
            self.log_view.clear()
            self._stdout_raw_pending.clear()
            self._stdout_line_tail = ""
            self._live_tail = ""
            self._live = {"accounts": 0, "packs": 0, "matches": 0, "errors": 0, "t0": time.time()}
            self._update_live_label(running=True)
            self._log_pending = []
        self._append_log("[gui] Community farm ON - Monitor Pokemon bot opens lent accounts.\n")
        self._community_timer = QTimer(self)
        self._community_timer.timeout.connect(self._community_tick)
        self._community_timer.start(1000)
        self._community_beat = QTimer(self)
        self._community_beat.timeout.connect(lambda: self._community_mark(True))
        self._community_beat.start(30000)
        # 2026-11-07 (Arcade): own accounts that were on their 24 h wait at Start were never picked up again
        # while the lent ones kept going (only a Stop + Start opened them). Every 15 min the own accounts are
        # scanned again; the ones that are ready open first (the farm waits: busy=True).
        self._own_rescan_timer = QTimer(self)
        self._own_rescan_timer.timeout.connect(self._rescan_own_accounts)
        self._own_rescan_timer.start(15 * 60 * 1000)
        self.btn_start.setEnabled(False)
        self.btn_cleanup.setEnabled(False)
        self.btn_stop.setEnabled(True)
        self.btn_stop.setText("■  STOP")
        self.w_community.setEnabled(False)
        self.status_label.setText("Community farm running.")
        self._set_badge("COMMUNITY", D["CYAN"])

    def _rescan_own_accounts(self):
        if not self._community or self._stopping:
            return
        if self.proc is not None and self.proc.state() != QProcess.NotRunning:
            return
        if not (self.w_xml_dir.text().strip() or self.w_accounts_dir.text().strip()):
            return
        self._append_log("\n[gui] Checking own accounts again (the ones off their wait open first)...\n")
        self._rescan_propias = True
        try:
            self._start_injection()
        finally:
            self._rescan_propias = False

    def _community_tick(self):
        if int(time.time()) % 5 == 0:
            self._update_left_card()
        try:
            size = self.COMMUNITY_LOG.stat().st_size
            if size < self._community_pos:
                self._community_pos = 0
            if size > self._community_pos:
                with open(self.COMMUNITY_LOG, "rb") as f:
                    f.seek(self._community_pos)
                    chunk = f.read(size - self._community_pos)
                self._community_pos = size
                self._stdout_raw_pending.extend(chunk)
        except Exception:
            pass

    def _stop_community(self):
        if not self._community:
            return
        self._community = False
        self._community_mark(False)
        try:
            self.COMMUNITY_STOP.write_text("stop", encoding="utf-8")
        except Exception:
            pass
        for nombre in ("_community_timer", "_community_beat", "_own_rescan_timer"):
            timer = getattr(self, nombre, None)
            if timer is not None:
                timer.stop()
        self._community_tick()
        self._append_log("\n[gui] Community farm OFF - finishing current account cleanup.\n")
        self.w_community.setEnabled(True)
        if self.proc is None or self.proc.state() == QProcess.NotRunning:
            self.btn_start.setEnabled(True)
            self.btn_cleanup.setEnabled(True)
            self.btn_stop.setEnabled(False)
            self.status_label.setText("Idle (Community farm stopped).")
            self._set_badge("IDLE", D["TEXT2"])
            self._update_live_label(running=False)

    def _on_stdout(self):
        if self.proc is None:
            return
        try:
            chunk = bytes(self.proc.readAllStandardOutput())
            self._stdout_raw_pending.extend(chunk)
            # Own accounts only (this process): how many it will open and how many it already did.
            texto = chunk.decode("utf-8", "replace")
            m = re.search(r"discovered: eligible=(\d+)", texto)
            if m:
                self._own_total = int(m.group(1))
            for m in re.finditer(r"ACCOUNT SUMMARY: opened (\d+)/", texto):
                self._own_done += 1
                if int(m.group(1)) > 0:
                    self._own_opened += 1
            self._update_left_card()
        except Exception:
            pass

    def _update_left_card(self):
        lent_left = lent_opened = 0
        try:
            st = json.loads((ROOT / "reports" / "community_farm_status.json").read_text("utf-8"))
            if self._community and time.time() * 1000 - float(st.get("ts", 0)) < 5 * 60 * 1000:
                lent_left, lent_opened = int(st.get("available", 0)), int(st.get("opened", 0))
        except Exception:
            pass
        own_left = max(0, self._own_total - self._own_done)
        left = own_left + lent_left
        try:
            self.stat_left._val_label.setText(f"{left:,} | {self._own_opened + lent_opened:,}")
            self.stat_left._eta.setText(f"Time left: {self._eta_text(left)}")
        except Exception:
            pass

    def _eta_text(self, left: int) -> str:
        """Accounts left ÷ accounts finished per minute in this session (own + lent)."""
        t0 = self._live.get("t0")
        if not left:
            return "done" if t0 else "—"
        if not t0:
            return "—"
        mins = (time.time() - t0) / 60.0
        done = self._live.get("accounts", 0)
        if mins < 2 or done < 3:
            return "calculating…"
        rest = int(left / (done / mins))
        h, m = divmod(rest, 60)
        d, h = divmod(h, 24)
        if d:
            return f"~{d}d {h}h"
        return f"~{h}h {m:02d}m" if h else f"~{m}m"

    def _on_finished(self, code, _status):
        self._append_log(f"\n[gui] process finished exit_code={code}\n")
        self._stopping = False
        self.btn_start.setEnabled(True)
        self.btn_cleanup.setEnabled(True)
        self.btn_stop.setEnabled(False)
        self.btn_stop.setText("■  STOP")
        self.status_label.setText(f"Idle (last exit: {code}).")
        self._set_badge("IDLE", D["TEXT2"])
        if self._community:
            self._community_mark(True)   # busy=False now: the lent accounts start right away
            self.btn_start.setEnabled(False)
            self.btn_cleanup.setEnabled(False)
            self.btn_stop.setEnabled(True)
            self.status_label.setText("Own accounts done — Community farm still running.")
            self._set_badge("COMMUNITY", D["CYAN"])
        stop_path = getattr(self, "_stop_f", None)
        if stop_path:
            try:
                if stop_path.exists():
                    stop_path.unlink()
            except Exception:
                pass
        self._update_live_label(running=False)
        if self._close_after_finish:
            QTimer.singleShot(300, self.close)

    def _append_log(self, text: str):
        if not text:
            return
        for ln in text.splitlines():
            if ln.strip():
                en_ln = self._translate_to_english(ln)
                self._log_pending.append(self._format_log_line_html(en_ln))

    # ── HTML Colorizer & Live Event Extractor ─────────────────────
    def _format_log_line_html(self, line: str) -> str:
        esc = _html.escape(line)

        # 1. GOD PACK REAL (Dorado brillante con fondo cálido)
        if "GOD PACK" in line or ("MATCH" in line and "/5" in line):
            return (
                f'<div style="background:#2e2408; color:{D["GOLD"]}; font-weight:800; '
                f'padding:2px 6px; border-left:3px solid {D["GOLD"]};">✨ {esc}</div>'
            )

        # 2. SOBRE NORMAL CON CARTA DE 2 ESTRELLAS (Rosa/Violeta representativo)
        if any(k in line for k in ("<-- RARE PACK", "<-- rare ", "1xSR", "2xSR")) or (
            "MATCH" in line and "/5" not in line
        ):
            return (
                f'<div style="background:#261230; color:{D["PINK"]}; font-weight:700; '
                f'padding:2px 6px; border-left:3px solid {D["ACCENT"]};">💎 {esc}</div>'
            )

        # 3. God Pack no elegible para Wonder Pick (Ámbar)
        if "UNPICKABLE" in line:
            return (
                f'<div style="background:#2d1a08; color:{D["AMBER"]}; font-weight:700; '
                f'padding:2px 6px; border-left:3px solid {D["AMBER"]};">⚠️ {esc}</div>'
            )

        # 4. Errores críticos y fallos (Rojo)
        if any(k in line for k in (
            "[!]", "[X]", "ABORTED", "PERMISSION_DENIED", "failed",
            "did NOT open", "login exhausted", "[AUTO-STOP]", "rate-limited"
        )):
            return f'<div style="color:{D["RED"]}; font-weight:700;">❌ {esc}</div>'

        # 5. Sobres normales abiertos y lista de cartas (Verde / Lavanda)
        if "pack opened cards=" in line:
            return f'<div style="color:{D["GREEN"]}; font-weight:700;">📦 {esc}</div>'
        if "cards: " in line:
            return f'<div style="color:#c4b5fd; font-weight:600; padding-left:14px;">🃏 {esc}</div>'

        # 6. Resumen de cuenta (Cian con línea divisoria)
        if "-- ACCOUNT SUMMARY:" in line:
            return (
                f'<div style="color:{D["CYAN"]}; font-weight:700; '
                f'border-bottom:1px dashed {D["BORDER"]}; padding-bottom:2px;">📊 {esc}</div>'
            )

        # 7. Flujo de conexión y solicitudes de amistad (Cian)
        if any(k in line for k in (
            "login OK", "friend requests sent to", "all ", "verify_power: server reports",
            "collectors resolved:", "discovered: eligible=", "DONE —", "DONE -",
            "online ID(s) detected:", "Total IDs ready for friend request:"
        )):
            return f'<div style="color:{D["CYAN"]};">{esc}</div>'

        # 8. Límites de velocidad, timeouts y advertencias (Ámbar)
        if any(k in line for k in ("[pack-budget]", "[timeout]", "skipping -", "unhealthy", "waiting 10s")):
            return f'<div style="color:{D["AMBER"]};">{esc}</div>'

        # 9. Limpieza de solicitudes (Gris tenue)
        if any(k in line for k in ("[fr-cleanup]", "CancelSentRequestsV1", "links removed")):
            return f'<div style="color:{D["TEXT3"]};">{esc}</div>'

        return f'<div style="color:{D["TEXT"]};">{esc}</div>'

    def _extract_tag(self, ln: str) -> str:
        """Extract the account tag from '[HH:MM:SS] [account_tag] message'."""
        m = re.match(r"^\[(\d{2}:\d{2}:\d{2})\]\s+(?:\[([^\]]+)\]\s+)?(.*)$", ln)
        if m:
            return m.group(2) or "system"
        return "system"

    def _flush_log_buffer(self):
        if self._stdout_raw_pending:
            try:
                raw_str = bytes(self._stdout_raw_pending).decode("utf-8", errors="replace")
            except Exception:
                raw_str = ""
            self._stdout_raw_pending.clear()

            if raw_str:
                self._process_live_stream(raw_str)

        if self._log_pending:
            html_chunk = "".join(self._log_pending)
            self._log_pending.clear()
            self.log_view.setUpdatesEnabled(False)
            try:
                bar = self.log_view.verticalScrollBar()
                at_bottom = bar.value() >= bar.maximum() - 10
                cursor = self.log_view.textCursor()
                cursor.movePosition(QTextCursor.End)
                cursor.insertHtml(html_chunk + "<br>")
                if at_bottom:
                    bar.setValue(bar.maximum())
            finally:
                self.log_view.setUpdatesEnabled(True)

        if self._events_pending:
            events_chunk = "".join(self._events_pending)
            self._events_pending.clear()
            self.pool_view.setUpdatesEnabled(False)
            try:
                bar = self.pool_view.verticalScrollBar()
                at_bottom = bar.value() >= bar.maximum() - 10
                cursor = self.pool_view.textCursor()
                cursor.movePosition(QTextCursor.End)
                cursor.insertHtml(events_chunk + "<br>")
                if at_bottom:
                    bar.setValue(bar.maximum())
            finally:
                self.pool_view.setUpdatesEnabled(True)

    # ── Live Stream Parser (Top Log + Bottom Hits/Alerts Feed) ────
    def _process_live_stream(self, raw_str: str):
        buf = self._live_tail + raw_str
        lines = buf.split("\n")
        self._live_tail = lines[-1]
        changed = False

        verbose = self.w_verbose.isChecked()
        show_cleanup = self.w_show_cleanup.isChecked()

        for raw_ln in lines[:-1]:
            ln = raw_ln.rstrip("\r")
            if not ln.strip():
                continue

            ln = self._translate_to_english(ln)
            tag = self._extract_tag(ln)

            # 1. KPI Counters & Strict God Pack Detection
            # (Arcade 2026-11-19) Gift-box packs are not opened packs of the farm: they don't count (PPM 212).
            if "pack opened cards=" in ln and "gift pack opened" not in ln:
                self._live["packs"] += 1
                self._last_pack_line[tag] = ln
                changed = True
                # SOLO registrar en el panel inferior si es un GOD PACK real
                # (Ignora <-- RARE PACK y <-- rare de 1 o 2 estrellas normales)
                # GIFT_NOT_GP_V1 (wR98/Ale 2026-11-17): a gift-box pack is not shared to Wonder Pick and is never
                # posted, so it doesn't count in GOD PACK HITS.
                if "GOD PACK" in ln and "gift pack opened" not in ln:
                    self._pending_hit_header[tag] = ln

            elif "cards: " in ln and tag in self._pending_hit_header:
                header_ln = self._pending_hit_header.pop(tag)
                # Ale 2026-11-12: count every God Pack found (Open Packs Only never "keeps" one, so it stayed at 0).
                if tag not in self._gp_counted:
                    self._gp_counted.add(tag)
                    self._live["matches"] += 1
                self._events_count["hits"] += 1
                self._events_pending.append(
                    f'<div style="background:#261f06; border:1px solid {D["GOLD"]}; '
                    f'border-radius:6px; padding:6px 10px; margin-bottom:4px;">'
                    f'<div style="color:{D["GOLD"]}; font-weight:900;">🌟 GOD PACK DETECTED: '
                    f'{_html.escape(header_ln)}</div>'
                    f'<div style="color:#fef08a; font-weight:700; padding-left:10px;">'
                    f'🃏 {_html.escape(ln.strip())}</div></div>'
                )
                changed = True

            if "-- ACCOUNT SUMMARY:" in ln:
                self._live["accounts"] += 1
                # Solo sumar al contador y fijar en el panel inferior si el match es un God Pack (X/5)
                # Ignora matches de sobres normales como 1xSR o 2xSR
                if "MATCH:" in ln and "/5" in ln:
                    if tag not in self._gp_counted:
                        self._live["matches"] += 1
                    self._events_pending.append(
                        f'<div style="background:#142e1f; border-left:4px solid {D["GREEN"]}; '
                        f'color:{D["GREEN"]}; font-weight:800; padding:4px 8px;">'
                        f'✅ GOD PACK KEPT: {_html.escape(ln)}</div>'
                    )
                changed = True

            # 2. Pin Critical Errors to Bottom Feed
            if any(err_k in ln for err_k in (
                "SendRequestsV1 failed", "SendRequestsV1 ABORTED", "SendRequestsV1 error",
                "PurchaseV2 failed:", "GetDetailV2 failed:", "GetPackPowerV1 failed",
                "login exhausted", "marking current proxy unhealthy", "[AUTO-STOP]",
                "verify_power: RPC failed", "Error reading Worker", "Error in SendRequestsV1 batch"
            )):
                self._live["errors"] += 1
                self._events_count["errors"] += 1
                self._events_pending.append(
                    f'<div style="background:#2c0b14; border-left:3px solid {D["RED"]}; '
                    f'color:{D["RED"]}; font-weight:700; padding:3px 8px;">'
                    f'🚨 {_html.escape(ln)}</div>'
                )
                changed = True

            # 3. Top Activity Log Filtering
            if verbose:
                self._log_pending.append(self._format_log_line_html(ln))
            else:
                if show_cleanup and self._CLEANUP_SPAM_PATTERNS.search(ln):
                    self._log_pending.append(self._format_log_line_html(ln))
                elif self._GUI_LINE_PATTERNS.search(ln):
                    self._log_pending.append(self._format_log_line_html(ln))

        if changed:
            self._update_live_label(running=True)

    def _clear_events_feed(self):
        self.pool_view.clear()
        self._events_count = {"hits": 0, "errors": 0}
        self._update_live_label(running=(self.proc is not None and self.proc.state() != QProcess.NotRunning))

    def _update_live_label(self, running: bool = False):
        t0 = self._live.get("t0")
        if t0 is None:
            self.live_label.setText(f"{img_juego('star', 14)} {self._events_count['hits']} Hits &nbsp;·&nbsp; {img_juego('alert', 14)} {self._events_count['errors']} Alerts")
            return
        mins = max(0.01, (time.time() - t0) / 60.0)
        ppm = self._live["packs"] / mins if mins > 0 else 0.0

        # Update top KPI cards
        self.stat_accounts._val_label.setText(str(self._live["accounts"]))
        self.stat_packs._val_label.setText(str(self._live["packs"]))
        self.stat_matches._val_label.setText(str(self._live["matches"]))
        self.stat_ppm._val_label.setText(f"{mins:.1f}m | {ppm:.1f} PPM")

        self.live_label.setText(
            f"{img_juego('star', 14)} {self._events_count['hits']} Hits &nbsp;·&nbsp; {img_juego('alert', 14)} {self._events_count['errors']} Alerts"
        )

    # ── Historical Pool Report Dialog (.md) ───────────────────────
    def _show_pool_report_dialog(self):
        dlg = QDialog(self)
        dlg.setWindowTitle("Historical Pool Report — god_pack_pool.md")
        dlg.resize(720, 520)
        vbox = QVBoxLayout(dlg)
        txt = QTextEdit()
        txt.setReadOnly(True)
        if POOL_REPORT.is_file():
            try:
                txt.setPlainText(POOL_REPORT.read_text("utf-8"))
            except Exception as exc:
                txt.setPlainText(f"(failed to read pool report: {exc})")
        else:
            txt.setPlainText("(no pool report file found yet)")
        vbox.addWidget(txt)
        btn_close = QPushButton("Close")
        btn_close.clicked.connect(dlg.accept)
        vbox.addWidget(btn_close, 0, Qt.AlignRight)
        dlg.exec_()

    # ── God Packs of this session (Ale 2026-11-09) ────────────────
    GP_HITS_FILE = ROOT / "reports" / "gp_hits.jsonl"

    GP_HITS_ALL_FILE = ROOT / "reports" / "gp_hits_all.json"

    def _all_gp_hits(self) -> list[dict]:
        """God Packs of every host (reports/gp_hits_all.json, written by Monitor Pokemon from Upstash) plus
        this PC's own list (reports/gp_hits.jsonl, written by discord_notifier.py), newest first.
        mode "packs-only" = opened in Open Packs Only (no Mains added, not usable); anything else = usable."""
        vistos, hits = set(), []
        try:
            comunidad = json.loads(self.GP_HITS_ALL_FILE.read_text("utf-8"))
        except Exception:
            comunidad = []
        locales = []
        try:
            for ln in self.GP_HITS_FILE.read_text("utf-8").splitlines():
                try:
                    locales.append(json.loads(ln))
                except Exception:
                    pass
        except Exception:
            pass
        for h in locales:   # first this PC's own ones: they keep their local collage
            h.setdefault("host", "this PC")
        for h in list(locales) + list(comunidad):
            if not isinstance(h, dict):
                continue
            clave = (str(h.get("id", "")), int(h.get("ts", 0) or 0))
            if clave in vistos:
                if h.get("host") and h.get("host") != "this PC":   # same God Pack: show the real host name
                    for x in hits:
                        if (str(x.get("id", "")), int(x.get("ts", 0) or 0)) == clave and x.get("host") == "this PC":
                            x["host"] = h["host"]
                continue
            vistos.add(clave)
            hits.append(dict(h))
        hits.sort(key=lambda h: int(h.get("ts", 0) or 0), reverse=True)
        return hits

    GP_IMG_URLS_FILE = ROOT / "reports" / "gp_img_urls.json"
    GP_RENDERS_DIR = ROOT / "reports" / "gp_renders"

    def _gp_discord_photo(self, h: dict, urls: dict) -> str:
        """God Packs from before the list existed: their photo is the KyuremBot post's image. Monitor Pokemon
        keeps fresh links in gp_img_urls.json; it's downloaded once (small size) and kept as a PNG."""
        base = str(h.get("img") or "")
        if not base:
            return ""
        out = self.GP_RENDERS_DIR / f"gp_old_{re.sub(r'[^0-9A-Za-z]', '', str(h.get('id', '')))}_{int(h.get('ts', 0) or 0)}.png"
        if out.is_file():
            return str(out)
        url = urls.get(base)
        if not url:
            return ""
        try:
            import io
            import urllib.request
            from PIL import Image
            pequeno = url.replace("cdn.discordapp.com", "media.discordapp.net") + "&width=960&height=415&format=webp"
            req = urllib.request.Request(pequeno, headers={"User-Agent": "Mozilla/5.0"})
            data = urllib.request.urlopen(req, timeout=15).read()
            self.GP_RENDERS_DIR.mkdir(parents=True, exist_ok=True)
            Image.open(io.BytesIO(data)).convert("RGB").save(out, "PNG")
            return str(out)
        except Exception:
            return ""

    def _gp_collage_path(self, h: dict, urls: dict = None) -> str:
        """The local collage, the Discord photo (old God Packs), or one built here from the card IDs."""
        local = str(h.get("image") or "")
        if local and Path(local).is_file():
            return local
        if h.get("img"):
            return self._gp_discord_photo(h, urls or {})
        cards = h.get("cards") or []
        if not cards:
            return ""
        try:
            from scripts.god_pack import discord_notifier as dn
            nombre = f"gp_list_{re.sub(r'[^0-9A-Za-z]', '', str(h.get('id', '')))}_{int(h.get('ts', 0) or 0)}.png"
            out = dn.build_collage_for_hit(cards, nombre) if hasattr(dn, "build_collage_for_hit") else None
            return str(out) if out else ""
        except Exception:
            return ""

    def _show_gp_hits_dialog(self):
        dlg = QDialog(self)
        dlg.setWindowTitle("God Packs")
        dlg.resize(1040, 760)
        vbox = QVBoxLayout(dlg)

        barra = QHBoxLayout()
        head = QLabel("🌟 God Packs")
        head.setStyleSheet(f"color: {D['GOLD']}; font-size: 18px; font-weight: 900;")
        barra.addWidget(head)
        barra.addStretch(1)
        w_when = NoScrollComboBox()
        w_when.addItem("This session", "session")
        w_when.addItem("Today", "today")
        w_when.addItem("Last 7 days", "week")
        w_when.addItem("All", "all")
        w_when.setCurrentIndex(0 if self._live.get("t0") else 1)
        w_hosts = NoScrollComboBox()
        w_hosts.addItem("All hosts", "all")
        w_hosts.addItem("Only this PC", "mine")
        w_kind = NoScrollComboBox()
        w_kind.addItem("✅ + ❌", "all")
        w_kind.addItem("Only ✅ usable", "ok")
        w_kind.addItem("Only ❌ not usable", "bad")
        for w in (w_when, w_hosts, w_kind):
            w.setMinimumWidth(150)
            barra.addWidget(w)
        vbox.addLayout(barra)

        nota = QLabel("✅ = GP farm (God Pack mode, Mains were added)   ·   "
                      "❌ = Open Packs Only (no Mains added, can't be used)")
        nota.setStyleSheet(f"color: {D['TEXT2']}; font-size: 11px;")
        vbox.addWidget(nota)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        vbox.addWidget(scroll)
        todos = self._all_gp_hits()
        mi_host = (self.w_host_name.text().strip() if hasattr(self, "w_host_name") else "") or ""

        def pintar():
            when, hosts, kind = w_when.currentData(), w_hosts.currentData(), w_kind.currentData()
            ahora = time.time()
            if when == "session":
                desde = (self._live.get("t0") or ahora - 24 * 3600) * 1000
            elif when == "today":
                lt = time.localtime(ahora)
                desde = time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1)) * 1000
            elif when == "week":
                desde = (ahora - 7 * 24 * 3600) * 1000
            else:
                desde = 0
            hits = []
            for h in todos:
                if int(h.get("ts", 0) or 0) < desde:
                    continue
                es_mio = h.get("host") in ("this PC", mi_host) or bool(h.get("image") and Path(str(h["image"])).is_file())
                if hosts == "mine" and not es_mio:
                    continue
                malo = h.get("mode") == "packs-only"
                if (kind == "ok" and malo) or (kind == "bad" and not malo):
                    continue
                hits.append(h)
            ok = sum(1 for h in hits if h.get("mode") != "packs-only")
            head.setText(f"🌟 {len(hits)} God Pack(s)  ·  ✅ {ok}  ·  ❌ {len(hits) - ok}")

            inner = QWidget()
            lista = QVBoxLayout(inner)
            lista.setSpacing(12)
            estado_pag["hits"], estado_pag["shown"], estado_pag["lista"] = hits, 0, lista
            estado_pag["gen"] = estado_pag.get("gen", 0) + 1
            if not hits:
                vacio = QLabel("No God Packs here yet. They show up as soon as one is found (on any host).")
                vacio.setStyleSheet(f"color: {D['TEXT2']}; font-size: 13px;")
                lista.addWidget(vacio)
            estado_pag["mas"] = QPushButton("Load 30 more")
            estado_pag["mas"].clicked.connect(lambda: agregar())
            lista.addWidget(estado_pag["mas"], 0, Qt.AlignHCenter)
            lista.addStretch(1)
            scroll.setWidget(inner)
            agregar()

        def tarjeta(h: dict, foto: str = None) -> QFrame:
            malo = h.get("mode") == "packs-only"
            card = QFrame(objectName="statCard")
            card.setStyleSheet(f"QFrame#statCard {{ border: 1px solid {D['RED'] if malo else D['GREEN']}; }}")
            cv = QVBoxLayout(card)
            cv.setContentsMargins(12, 10, 12, 10)
            hora = time.strftime("%d/%m/%y %H:%M", time.localtime(int(h.get("ts", 0) or 0) / 1000))
            estado = (f"<b style='color:{D['RED']}'>❌ NOT USABLE — Open Packs Only (no Mains added)</b>" if malo
                      else f"<b style='color:{D['GREEN']}'>✅ USABLE — GP farm (Mains added)</b>")
            vivo = {"alive": f"  <b style='color:{D['GREEN']}'>🟢 verified alive</b>",
                    "dead": f"  <b style='color:{D['RED']}'>💀 dead</b>"}.get(str(h.get("status") or ""), "")
            if h.get("host") == "Discord":
                donde = "📜 from the Discord posts"
                if h.get("found_by"):
                    donde += f" · 👤 found by {_html.escape(str(h['found_by']))}"
            else:
                donde = f"🖥 {_html.escape(str(h.get('host') or '?'))}"
            extra = "  ·  🎁 lent account" if h.get("lent") else ""
            post = (f"  ·  <a style='color:{D['CYAN']}' href='{_html.escape(str(h['post']))}'>open post ↗</a>"
                    if h.get("post") else "")
            txt = QLabel(
                f"{estado}{vivo}<br>"
                f"<b style='color:{D['GOLD']}; font-size:15px'>{_html.escape(str(h.get('name') or '?'))}</b>"
                f"  <span style='color:{D['TEXT2']}'>{_html.escape(str(h.get('tags') or ''))}  ·  {hora}"
                f"  ·  {donde}{extra}</span>{post}<br>"
                f"<span style='color:{D['TEXT']}'>ID: <b>{_html.escape(str(h.get('id') or '?'))}</b></span><br>"
                f"<span style='color:{D['TEXT']}'>XML: <b>{_html.escape(str(h.get('xml') or '?'))}</b></span>")
            txt.setTextInteractionFlags(Qt.TextBrowserInteraction)   # ID / XML can be copied, the link opens
            txt.setOpenExternalLinks(True)
            cv.addWidget(txt)
            img = QLabel()
            card.img = img
            if foto is None:   # still loading in the background (Ale 2026-11-10: the window froze)
                img.setText("⏳ Loading cards...")
                img.setStyleSheet(f"color: {D['TEXT2']}; font-size: 13px; padding: 30px;")
            else:
                poner_foto(img, foto)
            cv.addWidget(img)
            return card

        def poner_foto(img: QLabel, foto: str):
            pm = QPixmap(foto) if foto else QPixmap()
            if pm.isNull():
                img.setText("(cards image not available yet)")
                img.setStyleSheet(f"color: {D['TEXT3']};")
            else:
                img.setStyleSheet("")
                img.setPixmap(pm.scaledToWidth(940, Qt.SmoothTransformation))

        def agregar():
            hits, desde, lista = estado_pag["hits"], estado_pag["shown"], estado_pag["lista"]
            lote = hits[desde:desde + 30]
            if lote:
                try:
                    urls = json.loads(self.GP_IMG_URLS_FILE.read_text("utf-8"))
                except Exception:
                    urls = {}
                # Cards show at once with "Loading cards..."; the photos are built/downloaded in the background
                # and each one appears when ready (the window no longer freezes).
                pos = lista.indexOf(estado_pag["mas"])
                gen = estado_pag["gen"]
                for i, h in enumerate(lote):
                    c = tarjeta(h)
                    lista.insertWidget(pos + i, c)
                    carga["pend"] += 1
                    carga["pool"].submit(lambda h=h, c=c: carga["cola"].put((gen, c, self._gp_collage_path(h, urls))))
                actualizar_carga()
            estado_pag["shown"] = desde + len(lote)
            faltan = len(hits) - estado_pag["shown"]
            estado_pag["mas"].setVisible(faltan > 0)
            estado_pag["mas"].setText(f"Load {min(30, faltan)} more ({faltan} left)")

        estado_pag = {"gen": 0}
        import queue
        from concurrent.futures import ThreadPoolExecutor
        carga = {"cola": queue.Queue(), "pool": ThreadPoolExecutor(max_workers=8), "pend": 0}

        def actualizar_carga():
            dlg.setWindowTitle(f"God Packs  —  ⏳ loading {carga['pend']} photo(s)..." if carga["pend"] > 0 else "God Packs")

        def recibir_fotos():
            hubo = False
            while True:
                try:
                    gen, c, foto = carga["cola"].get_nowait()
                except queue.Empty:
                    break
                hubo = True
                carga["pend"] = max(0, carga["pend"] - 1)
                if gen != estado_pag["gen"]:
                    continue   # the filter changed: that card is gone
                try:
                    poner_foto(c.img, foto)
                except RuntimeError:
                    pass       # card already deleted
            if hubo:
                actualizar_carga()

        reloj = QTimer(dlg)
        reloj.timeout.connect(recibir_fotos)
        reloj.start(150)
        dlg.finished.connect(lambda _r: (reloj.stop(), carga["pool"].shutdown(wait=False)))

        for w in (w_when, w_hosts, w_kind):
            w.currentIndexChanged.connect(lambda _i: pintar())
        pintar()

        btn_close = QPushButton("Close")
        btn_close.clicked.connect(dlg.accept)
        vbox.addWidget(btn_close, 0, Qt.AlignRight)
        dlg.exec_()


def _app_icon() -> QIcon:
    if LOGO.is_file():
        pix = QPixmap(str(LOGO))
        if not pix.isNull():
            return QIcon(pix)
    return QIcon()


def main():
    app = QApplication(sys.argv)
    app.setWindowIcon(_app_icon())
    win = GodPackGui()
    win.setWindowIcon(_app_icon())
    win.show()
    sys.exit(app.exec_())


if __name__ == "__main__":
    main()