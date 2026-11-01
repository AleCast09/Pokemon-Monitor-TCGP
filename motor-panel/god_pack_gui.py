#!/usr/bin/env python3
"""
God Pack Injection GUI — standalone PyQt5 dashboard.

Spawns scripts/god_pack/inject.py with the configured parameters.
Streams live output. Shows the accumulated god pack pool.

Design mirrors flow_control_gui_v3.py: midnight-blue theme, background threads,
zero main-thread blocking. Purposely kept independent so both GUIs can run
simultaneously (main flow creation + this god pack injection).
"""
from __future__ import annotations
import json, os, re, sys, time, uuid
from pathlib import Path

from PyQt5.QtCore import Qt, QTimer, QProcess, QProcessEnvironment, QUrl
from PyQt5.QtGui import QColor, QFont, QIcon, QPixmap, QPainter, QTextCursor, QDesktopServices
from PyQt5.QtWidgets import (
    QApplication, QMainWindow, QWidget, QLabel, QLineEdit, QComboBox,
    QSpinBox, QDoubleSpinBox, QCheckBox, QPushButton, QTextEdit, QScrollArea,
    QVBoxLayout, QHBoxLayout, QGridLayout, QFrame, QSizePolicy, QMessageBox,
    QListWidget, QListWidgetItem, QAbstractItemView, QSplitter, QFileDialog,
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
# If it's not importable we fall back to a hardcoded default list.
try:
    from scripts.flow.pack_catalog import (
        paid_pack_options, product_id_for_pack, DEFAULT_PAID_PACK_ID
    )
    _PACK_CATALOG_OK = True
except Exception:
    _PACK_CATALOG_OK = False
    DEFAULT_PAID_PACK_ID = "BN010_0010_00_000"

    def paid_pack_options():
        # Minimal fallback — user should ensure pack_catalog is importable
        return [
            {"pack_id": "BN008_0010_00_000", "sku_id": "B4a_1",
             "name": "Team Rocket's Ambition"},
            {"pack_id": "CN001_0010_00_000", "sku_id": "C1_1",
             "name": "Dual Fusion Mega Mewtwo X"},
            {"pack_id": "CN001_0020_00_000", "sku_id": "C1_2",
             "name": "Dual Fusion Pikachu"},
        ]

    def product_id_for_pack(pack_id):
        # Best-effort lookup; user should fix pack_catalog import
        mapping = {
            "BN010_0010_00_000": "PC_PS_2608000_01_01_01",
            "BN001_0030_00_000": "PC_PS_2510000_01_03_01",
            "BN011_0010_00_000": "PC_PS_2609000_01_01_01",
        }
        return mapping.get(pack_id, "PC_PS_2608000_01_01_01")


# Packs that must always appear in the dropdown, even when the imported
# pack_catalog predates them. Only added if the catalog doesn't list them.
_EXTRA_PACKS = [
    {"pack_id": "BN011_0010_00_000", "sku_id": "B4b_1", "name": "Deluxe Mega",
     "product_id": "PC_PS_2609000_01_01_01"},
]

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


# ═══════ THEME ═══════
# Vibrant navy palette (matches the aesthetic of auto_trade_gui). The
# accent gradient (violet → pink) reads as "god pack" rather than the
# muted flat purple the earlier theme used, and every input surface is
# a step brighter than the panel so widgets are easy to spot on a busy
# window.
D = {
    "BG":       "#0b1024",   # deepest — window background
    "PANEL":    "#141a35",   # settings panel base
    "CARD":     "#1c2444",   # cards / focused inputs
    "INPUT":    "#161c38",   # base input surface
    "INPUT_HI": "#22295a",   # hover on input surface
    "BORDER":   "#2b3260",   # subtle borders
    "BORDER2":  "#3d4585",   # emphasised borders (focus, hover)
    "ACCENT":   "#a78bfa",   # violet — primary
    "ACCENT2":  "#8b5cf6",   # violet darker (hover / pressed)
    "PINK":     "#f472b6",   # secondary accent — Start button uses it
    "PINK2":    "#ec4899",
    "CYAN":     "#22d3ee",   # section headings
    "GREEN":    "#4ade80",
    "AMBER":    "#fbbf24",
    "RED":      "#f87171",
    "GOLD":     "#fde047",   # pool / god pack hits
    "TEXT":     "#e2e8f0",
    "TEXT2":    "#a5b4d4",
    "TEXT3":    "#6b7599",
}

STYLESHEET = f"""
QMainWindow, QWidget {{
    background: {D['BG']};
    color: {D['TEXT']};
    font-family: 'Segoe UI', 'Inter', sans-serif;
    font-size: 12px;
}}
QLabel {{ color: {D['TEXT2']}; }}
QLabel[section="true"] {{
    color: {D['CYAN']};
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    padding: 8px 0 6px 10px;
    border-left: 3px solid {D['ACCENT']};
    border-bottom: 1px solid {D['BORDER']};
    margin-top: 10px;
}}

/* ─── Text inputs ─── */
QLineEdit, QComboBox, NoScrollSpinBox, NoScrollDoubleSpinBox {{
    background: {D['INPUT']};
    color: {D['TEXT']};
    border: 1px solid {D['BORDER']};
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 12px;
    min-height: 24px;
    selection-background-color: {D['ACCENT2']};
}}
QLineEdit:hover, QComboBox:hover, NoScrollSpinBox:hover, NoScrollDoubleSpinBox:hover {{
    background: {D['INPUT_HI']};
    border-color: {D['BORDER2']};
}}
QLineEdit:focus, QComboBox:focus, NoScrollSpinBox:focus, NoScrollDoubleSpinBox:focus {{
    border: 1px solid {D['ACCENT']};
    background: {D['CARD']};
}}
QLineEdit:disabled, QComboBox:disabled, NoScrollSpinBox:disabled, NoScrollDoubleSpinBox:disabled {{
    color: {D['TEXT3']};
    background: {D['PANEL']};
    border-color: {D['BORDER']};
}}

/* ─── NoScrollSpinBox / NoScrollDoubleSpinBox arrow buttons ─── */
/* Explicit up/down button geometry — without this Qt tries to squeeze
   both arrows into whatever vertical room's left, and on Windows they
   render as unclickable slivers. This is what was locking "Packs per
   account" at 2 (couldn't click the up-arrow). */
NoScrollSpinBox, NoScrollDoubleSpinBox {{
    padding-right: 22px;    /* leave room for the button strip */
}}
NoScrollSpinBox::up-button, NoScrollDoubleSpinBox::up-button {{
    subcontrol-origin: border;
    subcontrol-position: top right;
    width: 20px;
    height: 14px;
    border: none;
    border-top-right-radius: 6px;
    background: {D['INPUT']};
    margin: 1px 1px 0 0;
}}
NoScrollSpinBox::down-button, NoScrollDoubleSpinBox::down-button {{
    subcontrol-origin: border;
    subcontrol-position: bottom right;
    width: 20px;
    height: 14px;
    border: none;
    border-bottom-right-radius: 6px;
    background: {D['INPUT']};
    margin: 0 1px 1px 0;
}}
NoScrollSpinBox::up-button:hover, NoScrollSpinBox::down-button:hover,
NoScrollDoubleSpinBox::up-button:hover, NoScrollDoubleSpinBox::down-button:hover {{
    background: {D['ACCENT2']};
}}
NoScrollSpinBox::up-button:pressed, NoScrollSpinBox::down-button:pressed,
NoScrollDoubleSpinBox::up-button:pressed, NoScrollDoubleSpinBox::down-button:pressed {{
    background: {D['ACCENT']};
}}
NoScrollSpinBox::up-arrow, NoScrollDoubleSpinBox::up-arrow {{
    image: none;
    width: 0; height: 0;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-bottom: 5px solid {D['TEXT']};
}}
NoScrollSpinBox::down-arrow, NoScrollDoubleSpinBox::down-arrow {{
    image: none;
    width: 0; height: 0;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-top: 5px solid {D['TEXT']};
}}

/* ─── QComboBox drop-down ─── */
QComboBox {{ padding-right: 26px; }}
QComboBox::drop-down {{
    subcontrol-origin: padding;
    subcontrol-position: center right;
    width: 22px;
    border: none;
    background: transparent;
}}
QComboBox::down-arrow {{
    image: none;
    width: 0; height: 0;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-top: 6px solid {D['ACCENT']};
    margin-right: 6px;
}}
QComboBox::down-arrow:hover {{ border-top-color: {D['PINK']}; }}
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
QCheckBox {{ color: {D['TEXT2']}; spacing: 8px; padding: 2px 0; }}
QCheckBox:hover {{ color: {D['TEXT']}; }}
QCheckBox::indicator {{
    width: 18px; height: 18px;
    border: 1.5px solid {D['BORDER2']};
    background: {D['INPUT']};
    border-radius: 5px;
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
    padding: 8px 16px;
    font-weight: 600;
}}
QPushButton:hover {{
    background: {D['INPUT_HI']};
    border-color: {D['ACCENT']};
    color: {D['TEXT']};
}}
QPushButton:pressed {{ background: {D['PANEL']}; }}
QPushButton:disabled {{
    color: {D['TEXT3']};
    background: {D['PANEL']};
    border-color: {D['BORDER']};
}}
QPushButton#startBtn {{
    background: qlineargradient(x1:0,y1:0,x2:1,y2:0,
        stop:0 {D['ACCENT']}, stop:1 {D['PINK']});
    color: white;
    border: none;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.5px;
    padding: 10px 22px;
}}
QPushButton#startBtn:hover {{
    background: qlineargradient(x1:0,y1:0,x2:1,y2:0,
        stop:0 {D['ACCENT2']}, stop:1 {D['PINK2']});
}}
QPushButton#startBtn:disabled {{
    background: {D['PANEL']};
    color: {D['TEXT3']};
}}
QPushButton#stopBtn {{
    background: rgba(248, 113, 113, 0.14);
    color: {D['RED']};
    border: 1px solid rgba(248, 113, 113, 0.4);
    font-weight: 700;
}}
QPushButton#stopBtn:hover {{
    background: rgba(248, 113, 113, 0.24);
    border-color: {D['RED']};
}}
QPushButton#stopBtn:disabled {{
    background: {D['PANEL']};
    color: {D['TEXT3']};
    border-color: {D['BORDER']};
}}

/* ─── Log / pool text areas ─── */
QTextEdit {{
    background: #070b1e;
    color: {D['TEXT2']};
    border: 1px solid {D['BORDER']};
    border-radius: 8px;
    padding: 10px;
    font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 11px;
    selection-background-color: {D['ACCENT2']};
}}
QTextEdit:focus {{ border-color: {D['ACCENT']}; }}

/* ─── Cards / scrollbars ─── */
QFrame#card {{
    background: {D['PANEL']};
    border: 1px solid {D['BORDER']};
    border-radius: 10px;
    padding: 8px;
}}
QScrollBar:vertical {{
    background: {D['PANEL']};
    width: 12px;
    border-radius: 6px;
    margin: 0;
}}
QScrollBar::handle:vertical {{
    background: {D['ACCENT2']};
    min-height: 30px;
    border-radius: 6px;
}}
QScrollBar::handle:vertical:hover {{ background: {D['ACCENT']}; }}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{
    background: none;
    height: 0;
}}
QScrollBar:horizontal {{
    background: {D['PANEL']};
    height: 12px;
    border-radius: 6px;
}}
QScrollBar::handle:horizontal {{
    background: {D['ACCENT2']};
    min-width: 30px;
    border-radius: 6px;
}}
QScrollBar::handle:horizontal:hover {{ background: {D['ACCENT']}; }}
QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {{
    background: none;
    width: 0;
}}

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

# Clase auxiliar para evitar que el scroll del mouse altere los números accidentalmente
class NoScrollSpinBox(QSpinBox):
    def wheelEvent(self, event):
        event.ignore()

class NoScrollDoubleSpinBox(QDoubleSpinBox):
    def wheelEvent(self, event):
        event.ignore()

class GodPackGui(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("God Pack Injection")
        self.resize(1200, 800)
        # Allow tall/short vertical resizing; keep some sensible minimums so
        # the log area stays usable.
        self.setMinimumSize(720, 400)
        self.setStyleSheet(STYLESHEET)

        self.proc: QProcess | None = None
        self._stop_f: Path | None = None   # graceful-stop marker file path
        self._run_id = 0                   # bumps each launch; stale timers check it
        self._stopping = False             # graceful stop in progress
        self._close_after_finish = False   # window close waiting for cleanup
        # COMMUNITY_FARM_V1 - GP farm de la comunidad (2026-11-01, pedido de Ale): con la casilla
        # "Community farm" el Start no abre las cuentas del panel: le avisa al bot de Monitor Pokemon
        # (reports/community_farm.json) que farmee las cuentas prestadas por Monitor Link, y el Live
        # Log muestra reports/reroll_comunidad.log. Sin Start, el bot no farmea nada.
        self._community = False            # Community farm en curso
        self._community_pos = 0            # hasta donde se leyo reroll_comunidad.log
        self._build_ui()
        self._load_settings()

        # Auto-refresh pool report every 15s
        self._pool_timer = QTimer(self)
        self._pool_timer.timeout.connect(self._refresh_pool)
        self._pool_timer.start(15000)
        self._refresh_pool()

    # ── UI ─────────────────────────────────────────────────────────
    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        # Root is now a QSplitter (not a plain QHBoxLayout) so the boundary
        # between the settings panel and the log/pool panel can be dragged
        # left/right. This also lets the settings panel be widened to show
        # long labels like "Verify pack power with server before sending FR
        # (slower, but skips ac...)" that used to get truncated at the fixed
        # 420px width. Root wraps the splitter in a thin QHBoxLayout so the
        # 16px window margins still apply.
        root = QHBoxLayout(central)
        root.setContentsMargins(16, 16, 16, 16)
        root.setSpacing(0)
        splitter = QSplitter(Qt.Horizontal)
        splitter.setChildrenCollapsible(False)  # don't let either side vanish
        splitter.setHandleWidth(10)              # thick enough to grab reliably
        splitter.setStyleSheet(
            # Visible-but-subtle vertical grab bar in the accent color.
            # QSplitter::handle:horizontal is the drag strip between children.
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

        # LEFT — settings panel wrapped in a scroll area so the window is
        # freely resizable vertically. Without the scroll area, shrinking
        # the window vertically clips the bottom controls.
        left_scroll = QScrollArea()
        left_scroll.setWidgetResizable(True)
        # Was setFixedWidth(420) — now a min width so the splitter can
        # widen it as far as the user wants and shrink it down to 280px.
        left_scroll.setMinimumWidth(280)
        left_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        # Always show the vertical scrollbar so the user can scan/scroll
        # through every section on any window height (was ScrollBarAsNeeded
        # by default, which hid the bar when the content happened to fit).
        left_scroll.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOn)
        # Explicit styling — without it Qt draws a near-invisible default
        # scrollbar on this dark background, which looks like nothing is
        # there. 12px wide purple thumb on dark INPUT-colored track.
        left_scroll.setStyleSheet(
            f"QScrollArea {{ background: {D['BG']}; border: none; }}"
            f"QScrollBar:vertical {{"
            f"    background: {D['INPUT']};"
            f"    width: 12px;"
            f"    margin: 0px;"
            f"    border: 1px solid {D['BORDER']};"
            f"    border-radius: 6px;"
            f"}}"
            f"QScrollBar::handle:vertical {{"
            f"    background: {D['ACCENT']};"
            f"    min-height: 30px;"
            f"    border-radius: 5px;"
            f"    margin: 1px;"
            f"}}"
            f"QScrollBar::handle:vertical:hover {{"
            f"    background: #A78BFA;"
            f"}}"
            f"QScrollBar::add-line:vertical,"
            f"QScrollBar::sub-line:vertical {{"
            f"    height: 0px;"
            f"    background: transparent;"
            f"}}"
            f"QScrollBar::add-page:vertical,"
            f"QScrollBar::sub-page:vertical {{"
            f"    background: transparent;"
            f"}}"
        )

        left = QFrame(objectName="card")
        left_layout = QVBoxLayout(left)
        left_layout.setContentsMargins(12, 12, 12, 12)
        left_layout.setSpacing(4)
        left_scroll.setWidget(left)

        self._add_section(left_layout, "◈ Collectors")

        # List of saved friend codes
        self.w_collectors = QListWidget()
        self.w_collectors.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.w_collectors.setFixedHeight(120)
        self.w_collectors.setStyleSheet(
            f"QListWidget {{ background: {D['INPUT']}; border: 1px solid {D['BORDER']}; "
            f"border-radius: 6px; padding: 4px; color: {D['TEXT']}; }}"
            f"QListWidget::item {{ padding: 4px 6px; }}"
            f"QListWidget::item:selected {{ background: {D['ACCENT']}; color: white; }}"
        )
        left_layout.addWidget(self.w_collectors)

        # Add / remove UI

        self.w_ppm_interval = NoScrollSpinBox()
        self.w_ppm_interval.setRange(1, 60)
        self.w_ppm_interval.setValue(5) # Cada 5 minutos por defecto
        self._add_field(left_layout, "PPM Discord Interval (min)", self.w_ppm_interval)

        # Ale 2026-10-30: datos de Discord en el panel (antes estaban fijos en el codigo, con los de wr98).
        self.w_host_name = QLineEdit()
        self.w_host_name.setPlaceholderText("Ale Cast")
        self._add_field(left_layout, "Host name (shown in Discord)", self.w_host_name)
        self.w_gp_webhook = QLineEdit()
        self.w_gp_webhook.setPlaceholderText("https://discord.com/api/webhooks/...")
        self._add_field(left_layout, "God pack webhook (Discord)", self.w_gp_webhook)
        self.w_ppm_webhook = QLineEdit()
        self.w_ppm_webhook.setPlaceholderText("https://discord.com/api/webhooks/...  (empty = no PPM)")
        self._add_field(left_layout, "PPM webhook (Discord)", self.w_ppm_webhook)
        self.w_mention_id = QLineEdit()
        self.w_mention_id.setPlaceholderText("Discord user ID to mention (empty = nobody)")
        self._add_field(left_layout, "Mention on god pack", self.w_mention_id)

        add_row = QHBoxLayout()
        self.w_collector_input = QLineEdit()
        self.w_collector_input.setPlaceholderText("9370-0010-9308-6237 or 16 digits or UUID")
        self.w_collector_input.returnPressed.connect(self._add_collector)
        add_row.addWidget(self.w_collector_input, 1)
        self.btn_collector_add = QPushButton("Add")
        self.btn_collector_add.setFixedWidth(60)
        self.btn_collector_add.clicked.connect(self._add_collector)
        add_row.addWidget(self.btn_collector_add)
        self.btn_collector_remove = QPushButton("Remove")
        self.btn_collector_remove.setFixedWidth(80)
        self.btn_collector_remove.clicked.connect(self._remove_selected_collectors)
        add_row.addWidget(self.btn_collector_remove)
        add_row_w = QWidget()
        add_row_w.setLayout(add_row)
        left_layout.addWidget(add_row_w)

        # ── NUEVO CAMPO: URL DEL WORKER EN VIVO ──
        self.w_worker_url = QLineEdit()
        self.w_worker_url.setPlaceholderText("https://onlineids.zenithrise.workers.dev/elite")
        self.w_worker_url.setToolTip("URL de tu Worker de Cloudflare para obtener IDs en línea automáticamente.")
        self._add_field(left_layout, "Worker URL (Live ID List)", self.w_worker_url)

        self.w_collectors_hint = QLabel(
            "Friend requests go to ALL listed collectors per account + live Worker URL. "
            "If no god pack → all unfriended."
        )
        self.w_collectors_hint.setWordWrap(True)
        self.w_collectors_hint.setStyleSheet(
            f"color: {D['TEXT3']}; font-size: 10px; padding-top: 2px;"
        )
        left_layout.addWidget(self.w_collectors_hint)

        self._add_section(left_layout, "◈ Mode")
        # Two overall run modes:
        #   godpack     — send FR, open packs, keep/unfriend by wishlist
        #   packs-only  — no FR, just open the daily packs (keeps accounts
        #                 active for the 96-packs-in-2-4mo WP eligibility)
        self.w_run_mode = QComboBox()
        self.w_run_mode.addItem("God Pack Farming", "godpack")
        self.w_run_mode.addItem("Open Packs Only (no FR, no wishlist)", "packs-only")
        self._add_field(left_layout, "Run mode", self.w_run_mode)
        self.w_run_mode.currentIndexChanged.connect(self._update_mode_enabled)

        self._add_section(left_layout, "◈ Wishlist (godpack mode)")

        # Farming mode — Only GP vs GP & Double 2*
        self.w_farming_mode = QComboBox()
        self.w_farming_mode.addItem("Only GP  (99% of members)", "only_gp")
        self.w_farming_mode.addItem("GP & Double (2xSR normal packs too)", "gp_double")
        self.w_farming_mode.addItem("GP & Single or Double (1xSR or 2xSR normal packs)", "gp_single")
        self._add_field(left_layout, "Farming mode", self.w_farming_mode)

        # Pack Power minimum threshold. 0/5 (Dog Pack) omitted per user request.
        # Threshold = minimum: 3/5 matches 3/5, 4/5, 5/5.
        # Supports both 5-card and 4-card (Mega Deluxe) god packs.
        self.w_pack_power_min = QComboBox()
        tier_descriptions = [
            ("5/5", "5/5 ☆☆☆☆☆ Perfect (all 2-star)"),
            ("4/5", "4/5 ☆☆☆☆ Excellent (four 2-star)"),
            ("3/5", "3/5 ☆☆☆ Very Good (three 2-star)"),
            ("2/5", "2/5 ☆☆ Good (two 2-star)"),
            ("1/5", "1/5 ☆ Minimum (one 2-star)"),
        ]
        for tier_value, tier_label in tier_descriptions:
            self.w_pack_power_min.addItem(f"{tier_label} (and higher)", tier_value)
        self.w_pack_power_min.setCurrentIndex(2)  # Default to 3/5
        self._add_field(left_layout, "Pack Power threshold", self.w_pack_power_min)

        self._add_section(left_layout, "◈ Pack")
        self.w_pack = QComboBox()
        for pack in paid_pack_options():
            label = f"[{pack.get('sku_id', '?')}] {pack.get('name', '?')} — {pack['pack_id']}"
            self.w_pack.addItem(label, pack["pack_id"])
        default_idx = max(0, self.w_pack.findData(DEFAULT_PAID_PACK_ID))
        self.w_pack.setCurrentIndex(default_idx)
        self._add_field(left_layout, "Pack to open", self.w_pack)

        self.w_packs = NoScrollSpinBox()
        self.w_packs.setRange(1, 100)
        self.w_packs.setValue(2)
        self.w_packs.setSingleStep(1)
        self.w_packs.setToolTip(
            "How many packs to open per farm account per run.\n"
            "Rocket (free event pack): capped by pack-power (1-2/day).\n"
            "Paid packs (Mega Rising, Shining, etc.): each open spends "
            "12 LARGE hourglasses via heal_items, so 10 packs = 120 LARGE.\n"
            "Set --min-hourglass to at least packs × 12 so low-balance "
            "accounts get skipped before login."
        )
        self._add_field(left_layout, "Packs per account", self.w_packs)

        self._add_section(left_layout, "◈ Timing & concurrency")
        self.w_wait = NoScrollDoubleSpinBox()
        self.w_wait.setRange(0.0, 60.0)
        self.w_wait.setDecimals(1)
        self.w_wait.setValue(7.0)
        self._add_field(left_layout, "Wait after friend req (s)", self.w_wait)

        # Max seconds to poll for friend accept. 0 = disabled (falls back to
        # the fixed 'Wait after friend req' above). When > 0, inject.py polls
        # the friend list every 2s and opens packs the moment ALL sent FRs
        # are accepted. If nothing accepts within this window, it cancels
        # the outgoing FRs and skips the account.
        self.w_accept_timeout = NoScrollDoubleSpinBox()
        self.w_accept_timeout.setRange(0.0, 600.0)
        self.w_accept_timeout.setDecimals(1)
        self.w_accept_timeout.setSingleStep(5.0)
        self.w_accept_timeout.setValue(0.0)
        self._add_field(left_layout, "Max wait for FR accept (s, 0=off)",
                        self.w_accept_timeout)

        # Auto-stop after N consecutive account failures (login_failed or
        # PERMISSION_DENIED). 0 = disabled. When triggered, the run halts
        # and the GUI holds the last state so you can see what happened.
        # Parallel-safe: counter is thread-safe and any qualifying failure
        # from any worker bumps it; any success resets it to 0.
        self.w_stop_after_fails = NoScrollSpinBox()
        self.w_stop_after_fails.setRange(0, 10000)
        self.w_stop_after_fails.setValue(0)
        self._add_field(left_layout, "Auto-stop after N failures (0=off)",
                        self.w_stop_after_fails)

        # Delay between two pack opens on the same account. Base value gets
        # ±20% jitter applied by inject.py, so 2.0 → 1.6-2.4s. Bump when the
        # server rate-limits pack opens.
        self.w_pack_delay = NoScrollDoubleSpinBox()
        self.w_pack_delay.setRange(0.5, 30.0)
        self.w_pack_delay.setDecimals(1)
        self.w_pack_delay.setSingleStep(0.5)
        self.w_pack_delay.setValue(2.0)
        self._add_field(left_layout, "Delay between packs (s)", self.w_pack_delay)

        # Delay between accounts (sequential mode only — ignored when
        # parallel > 1). Same ±20% jitter model.
        self.w_account_delay = NoScrollDoubleSpinBox()
        self.w_account_delay.setRange(0.0, 60.0)
        self.w_account_delay.setDecimals(1)
        self.w_account_delay.setSingleStep(0.5)
        self.w_account_delay.setValue(2.0)
        self._add_field(left_layout, "Delay between accounts (s)", self.w_account_delay)

        self.w_cooldown = NoScrollDoubleSpinBox()
        self.w_cooldown.setRange(0.5, 168.0)
        self.w_cooldown.setDecimals(1)
        self.w_cooldown.setValue(24.0)
        self._add_field(left_layout, "Cooldown per account (h)", self.w_cooldown)

        self.w_parallel = NoScrollSpinBox()
        self.w_parallel.setRange(1, 32)
        self.w_parallel.setValue(1)
        self._add_field(left_layout, "Parallel workers", self.w_parallel)

        self.w_limit = NoScrollSpinBox()
        self.w_limit.setRange(0, 100000)
        self.w_limit.setValue(0)
        self._add_field(left_layout, "Max accounts (0 = all)", self.w_limit)

        # Processing order — matters when you have hundreds of accounts and
        # only want to process a subset (with Max accounts above), or when you
        # want to work through the pool fairly. Sort is applied to the
        # cooldown-eligible list BEFORE the Max accounts cap, so "Oldest first
        # + Max 10" gives you the 10 accounts that have been waiting longest.
        self.w_sort_order = QComboBox()
        self.w_sort_order.addItem("Filename (alphabetical, default)", "filename")
        self.w_sort_order.addItem("Oldest first (longest since last pack)", "oldest")
        self.w_sort_order.addItem("Newest first (most recently drained)", "newest")
        self._add_field(left_layout, "Processing order", self.w_sort_order)

        # Nintendo caps friend-request accepts on the collector side at
        # ~58/min. Send faster than that and requests start silently failing.
        self.w_fr_per_min = NoScrollDoubleSpinBox()
        self.w_fr_per_min.setRange(0.0, 300.0)
        self.w_fr_per_min.setDecimals(0)
        self.w_fr_per_min.setValue(58.0)
        self._add_field(left_layout, "Max FR per minute (0=off)", self.w_fr_per_min)

        # NEW: PER-COLLECTOR pack-open ceiling per minute. Each collector
        # ID gets its own 60s window; total throughput = N × ceiling.
        # Shared across every inject.py process on this machine via
        # <project>/.pack_budget.json (file-locked). Set to 55 and each
        # collector stays under 55/min no matter how many GUIs are open.
        self.w_packs_per_min = NoScrollDoubleSpinBox()
        self.w_packs_per_min.setRange(0.0, 500.0)
        self.w_packs_per_min.setDecimals(0)
        self.w_packs_per_min.setValue(55.0)
        self.w_packs_per_min.setToolTip(
            "Cap on pack-opens per minute PER COLLECTOR ID. Each "
            "collector gets its own independent 60s window; total "
            "throughput scales with collector count (N × this value). "
            "Shared across every inject.py instance on this machine "
            "(coordinated via <project>/.pack_budget.json), so 15 GUIs "
            "can't overshoot a single collector's cap. "
            "0 disables (falls back to FR/min throttle only)."
        )
        self._add_field(left_layout, "Packs/min per collector (all instances)",
                        self.w_packs_per_min)

        self._add_section(left_layout, "◈ Proxy")
        self.w_proxy_file = QLineEdit("proxies.txt")
        self.w_proxy_file.setToolTip(
            "Text file with one proxy URL per line (e.g. http://user:pass@host:port). "
            "Relative paths resolve against the project root."
        )
        self._add_path_field(left_layout, "Proxy file", self.w_proxy_file,
                             is_file=True, dialog_title="Select proxy list file")

        self.w_proxy_scheme = QComboBox()
        self.w_proxy_scheme.addItems(["http", "https", "socks5"])
        self._add_field(left_layout, "Proxy scheme", self.w_proxy_scheme)

        # NEW: shuffle proxy pool once at startup. Every restart hits IPs
        # in a different order so the same handful of proxies aren't always
        # tried first. Workers within THIS run still share the shuffled
        # order (accounts stay in sync on which proxy comes next).
        self.w_shuffle_proxies = QCheckBox("Shuffle proxies on restart")
        self.w_shuffle_proxies.setChecked(True)
        self.w_shuffle_proxies.setToolTip(
            "Randomize the proxy pool order once, at bot startup. Every "
            "restart of the God Pack GUI reshuffles, so the same IPs aren't "
            "always the first ones tried. Workers inside a single run share "
            "the same shuffled order — accounts stay in sync on which proxy "
            "comes next."
        )
        self._add_field(left_layout, "", self.w_shuffle_proxies)

        # How long a proxy that failed the post-login health check (403 /
        # block page) stays out of rotation before it is tried again.
        self.w_proxy_revive = NoScrollSpinBox()
        self.w_proxy_revive.setRange(0, 86400)
        self.w_proxy_revive.setValue(300)
        self.w_proxy_revive.setSuffix(" s")
        self.w_proxy_revive.setToolTip(
            "A proxy that returns 403 / a block page right after login is "
            "taken out of rotation and revived after this many seconds. "
            "Cooldowns persist in .god_pack_bad_proxies.json using hashed "
            "proxy identifiers. 0 = never blacklist (just rotate to the next proxy)."
        )
        self._add_field(left_layout, "Revive dead proxies after",
                        self.w_proxy_revive)

        # Proxy health check tuning (runs right after login, before packs).
        self.w_proxy_checks = NoScrollSpinBox()
        self.w_proxy_checks.setRange(1, 10)
        self.w_proxy_checks.setValue(3)
        self.w_proxy_checks.setToolTip(
            "How many times a proxy is tested (on the same connection) "
            "before it is declared dead and blacklisted. 1 = blacklist on "
            "the first failure. Higher = safer against one-off hiccups but "
            "slower on truly dead proxies.")
        self._add_field(left_layout, "Proxy checks before it's dead",
                        self.w_proxy_checks)

        self.w_proxy_check_gap = NoScrollDoubleSpinBox()
        self.w_proxy_check_gap.setRange(0.0, 30.0)
        self.w_proxy_check_gap.setDecimals(1)
        self.w_proxy_check_gap.setSingleStep(0.5)
        self.w_proxy_check_gap.setValue(2.0)
        self.w_proxy_check_gap.setSuffix(" s")
        self.w_proxy_check_gap.setToolTip(
            "Pause between two checks on the same proxy.")
        self._add_field(left_layout, "Gap between proxy checks",
                        self.w_proxy_check_gap)

        self.w_proxy_rotations = NoScrollSpinBox()
        self.w_proxy_rotations.setRange(1, 20)
        self.w_proxy_rotations.setValue(3)
        self.w_proxy_rotations.setToolTip(
            "How many different proxies one account may try. If every one "
            "of them is dead the account is skipped (no cooldown stamped, "
            "retried next run).")
        self._add_field(left_layout, "Proxies tried per account",
                        self.w_proxy_rotations)

        self._add_section(left_layout, "◈ Accounts")

        # Fallback / default directory — used ONLY when both XML dir and JSON
        # dir below are left blank. If you point XML dir + JSON dir at the
        # leannew paths (like the screenshots), Accounts dir is unused —
        # it's just a fallback for setups where XML and JSON live together.
        self.w_accounts_dir = QLineEdit(str(ROOT / "accounts"))
        self.w_accounts_dir.setToolTip(
            "FALLBACK folder used only when 'XML dir' AND 'JSON dir' below "
            "are BOTH blank. Older setups keep XML and JSON files in the "
            "same folder — this points there. If you set XML dir / JSON dir "
            "separately (leannew-style), this field is ignored."
        )
        self._add_path_field(left_layout, "Accounts dir (fallback)",
                             self.w_accounts_dir,
                             dialog_title="Select fallback accounts folder")

        # Separate XML and JSON directories (auto-trade style)
        self.w_xml_dir = QLineEdit("")
        self.w_xml_dir.setPlaceholderText("(optional) leave blank to use Accounts dir")
        self.w_xml_dir.setToolTip(
            "Folder holding the account .xml files (e.g. leannew's Saved "
            "folder). Searched recursively. Overrides Accounts dir."
        )
        self._add_path_field(left_layout, "XML dir (recursive)", self.w_xml_dir,
                             dialog_title="Select XML folder")

        self.w_json_dir = QLineEdit("")
        self.w_json_dir.setPlaceholderText("(optional) leave blank to use Accounts dir")
        self.w_json_dir.setToolTip(
            "Folder holding the account .json files (e.g. leannew's Cards/accounts). "
            "Matched to XML files by shared basename OR by {deviceAccount}.json. "
            "Overrides Accounts dir."
        )
        self._add_path_field(left_layout, "JSON dir", self.w_json_dir,
                             dialog_title="Select JSON folder")

        self.w_paths_hint = QLabel(
            "Leave XML/JSON dir blank to use Accounts dir for both. "
            "When set, XML dir is searched recursively; JSON matched by shared "
            "basename or by {deviceAccount}.json."
        )
        self.w_paths_hint.setWordWrap(True)
        self.w_paths_hint.setStyleSheet(
            f"color: {D['TEXT3']}; font-size: 10px; padding-top: 2px;"
        )
        left_layout.addWidget(self.w_paths_hint)

        self.w_dry_run = QCheckBox("Dry run (no packs actually opened)")
        left_layout.addWidget(self.w_dry_run)

        # Verify power via server before sending FR — slower per account
        # but stops wasting FRs on accounts leannew has drained since we
        # last read the JSON.
        self.w_verify_power = QCheckBox(
            "Verify pack power with server before sending FR "
            "(slower, but skips accounts leannew drained)")
        left_layout.addWidget(self.w_verify_power)

        # Verbose toggle — off by default so the log view shows only the
        # pack-relevant lines. Flip on to see the full RPC/session stream.
        self.w_verbose = QCheckBox("Show verbose output (raw RPC / session log)")
        left_layout.addWidget(self.w_verbose)

        # Locked-account quarantine — when login fails with a real auth
        # block (PERMISSION_DENIED with details) after we've tried multiple
        # proxies, move the account files to accounts/QUARANTINE/likely_banned/
        # and add the device_account to reports/skip_accounts.txt so we
        # never waste another login attempt on it. Uncertain failures go to
        # accounts/QUARANTINE/unknown_failure/ for you to review. Transient
        # proxy/tunnel failures never trigger this.
        self.w_quarantine_locked = QCheckBox(
            "Quarantine locked accounts (moves banned accounts out of the pool)"
        )
        self.w_quarantine_locked.setChecked(True)
        self.w_quarantine_locked.setToolTip(
            "When ON, a login failure that looks like a real ban (auth "
            "block after trying >=2 proxies) moves the account files to "
            "accounts/QUARANTINE/likely_banned/ and skip-lists the account "
            "so it's never tried again. Unknown-cause failures go to "
            "accounts/QUARANTINE/unknown_failure/ for manual review — those "
            "are NOT auto-skip-listed. Proxy/tunnel issues never move files."
        )
        left_layout.addWidget(self.w_quarantine_locked)

        # Post-pack "showcase like" — after any successful pack open, send
        # Collection/LikeV1 to target IDs. Only the first five selected farm
        # accounts can send, and the cycle is remembered for 24 hours.
        self.w_send_likes = QCheckBox(
            "Send collection likes (first 5 accounts, once per 24 hours)"
        )
        self.w_send_likes.setChecked(False)
        self.w_send_likes.setToolTip(
            "When ON, only the first five accounts in the selected processing "
            "order can send Collection/LikeV1 to targets in the LIKE TARGETS "
            "file. The bot records the cycle in reports/god_pack_like_ledger.json "
            "before sending; restarting the project will not initiate another "
            "like cycle until 24 hours have elapsed. Existing per-account and "
            "per-target safeguards still apply."
        )
        left_layout.addWidget(self.w_send_likes)

        self.w_like_file = QLineEdit("like_targets.txt")
        self.w_like_file.setToolTip(
            "Text file with one friend code per line (16 digits, dashed or "
            "raw; '#' starts a comment). Relative paths resolve against the "
            "project root. Read once at the start of each run."
        )
        self._add_path_field(left_layout, "Like targets file", self.w_like_file,
                             is_file=True, dialog_title="Select like targets file")
        self.btn_open_like_file = QPushButton("Open / create like targets file")
        self.btn_open_like_file.setToolTip("Creates the file if missing and opens it in your text editor.")
        self.btn_open_like_file.clicked.connect(self._open_like_file)
        left_layout.addWidget(self.btn_open_like_file)

        # Pre-pack "dismiss welcome/60HG popup" — flips two flags in
        # PlayerComeBackData--1 from false→true so PurchaseV2 isn't
        # blocked on old accounts. Idempotent, default ON.
        self.w_dismiss_popups = QCheckBox(
            "Dismiss welcome-back / 60HG popups on old accounts (recommended)"
        )
        self.w_dismiss_popups.setChecked(True)
        self.w_dismiss_popups.setToolTip(
            "When ON, right after login the bot reads "
            "PlayerComeBackData--1 and flips IsViewedWelcomeMessage / "
            "IsViewedMissionAccomplishedMessage from false to true if "
            "needed, then writes it back with a fresh revision. Without "
            "this, dormant accounts can refuse PurchaseV2 on the first "
            "run of the day. Idempotent — no-ops when both flags are "
            "already true."
        )
        left_layout.addWidget(self.w_dismiss_popups)

        # Minimum LARGE hourglasses required to touch the account.
        # Paid packs cost 12 LARGE each. 0 = disabled. Typical values:
        # 120 for a 10-pack farm, 240 for two 10-packs, etc.
        row_hg = QHBoxLayout()
        row_hg.setContentsMargins(0, 0, 0, 0)
        row_hg.setSpacing(6)
        lbl_hg = QLabel("Min hourglasses to open packs")
        self.w_min_hourglass = NoScrollSpinBox()
        self.w_min_hourglass.setRange(0, 100000)
        self.w_min_hourglass.setSingleStep(12)
        self.w_min_hourglass.setValue(0)
        self.w_min_hourglass.setToolTip(
            "Skip an account whose LARGE hourglass count is below this "
            "threshold. Paid packs cost 12 LARGE each, so 120 covers a "
            "10-pack farm run cleanly. Set 0 to disable the gate."
        )
        row_hg.addWidget(lbl_hg)
        row_hg.addWidget(self.w_min_hourglass)
        row_hg.addStretch(1)
        left_layout.addLayout(row_hg)

        # Free packs only: never spend hourglasses. Ticked -> --hg-cost 0,
        # so the run opens only as many packs as the account has FREE pack
        # power (1 or 2), skips accounts with 0, and stops there.
        # Unticked (default) -> free packs first, then 12 LARGE per extra
        # pack on paid pack types.
        self.w_free_only = QCheckBox(
            "Free packs only - stop at the free pack, never spend hourglasses")
        self.w_free_only.setChecked(False)
        self.w_free_only.setToolTip(
            "Ticked: open only the account's free (recharged) packs. If it "
            "has 1 free pack, open 1 and move on; if 0, skip the account. "
            "No hourglasses are ever spent.\n"
            "Unticked: open free packs first, then spend 12 LARGE "
            "hourglasses per remaining pack (paid pack types only).")
        left_layout.addWidget(self.w_free_only)

        # Community farm (COMMUNITY_FARM_V1): Start farmea las cuentas que los miembros prestan por
        # Monitor Link (lo hace el bot de Monitor Pokemon), en vez de las carpetas de arriba.
        self.w_community = QCheckBox(
            "Also open the community's lent accounts (Monitor Link) - Community farm")
        self.w_community.setChecked(True)
        self.w_community.setToolTip(
            "Ticked: Start opens your accounts (folders above) AND the accounts members lend through "
            "Monitor Link, at the same time. Your Monitor Pokemon bot opens the lent ones; the Live Log "
            "shows both. Stop, or closing this window, stops both and this host goes Offline.\n"
            "Unticked: Start opens only your accounts, as before.")
        left_layout.addWidget(self.w_community)

        # Buttons — compact row (28px tall instead of Qt's ~35px default) so
        # more of the settings panel is visible without scrolling to reach
        # them, and they don't dominate the bottom of the panel.
        btn_row = QHBoxLayout()
        btn_row.setSpacing(6)
        self.btn_save = QPushButton("Save Settings")
        self.btn_save.setMaximumHeight(28)
        self.btn_save.clicked.connect(self._save_settings)
        btn_row.addWidget(self.btn_save)

        self.btn_start = QPushButton("Start Injection")
        self.btn_start.setObjectName("startBtn")
        self.btn_start.setMaximumHeight(28)
        self.btn_start.clicked.connect(self._start_injection)
        btn_row.addWidget(self.btn_start)

        self.btn_stop = QPushButton("Stop")
        self.btn_stop.setObjectName("stopBtn")
        self.btn_stop.setMaximumHeight(28)
        self.btn_stop.clicked.connect(self._stop_injection)
        self.btn_stop.setEnabled(False)
        btn_row.addWidget(self.btn_stop)

        left_layout.addSpacing(6)   # was 10
        left_layout.addLayout(btn_row)

        # Manual sweep: logs into every account in reports/fr_ledger.json and
        # removes accepted friendships + cancels pending FRs to collectors.
        self.btn_cleanup = QPushButton("Clean up leftover friend requests")
        self.btn_cleanup.setMaximumHeight(28)
        self.btn_cleanup.setToolTip(
            "Runs inject.py --cleanup-only: every account that still has a "
            "pending or accepted friend request with a collector (from a "
            "crash, force-kill or failed cleanup) is logged in and cleaned.")
        self.btn_cleanup.clicked.connect(self._start_cleanup_only)
        left_layout.addWidget(self.btn_cleanup)

        self.status_label = QLabel("Idle.")
        self.status_label.setStyleSheet(f"color: {D['TEXT3']}; padding-top: 6px;")
        left_layout.addWidget(self.status_label)

        left_layout.addStretch(1)

        # RIGHT — log + pool viewer
        right = QVBoxLayout()
        right.setSpacing(10)

        log_header = QLabel("◈ LIVE LOG")
        log_header.setProperty("section", True)
        log_header.setStyleSheet(
            f"color: {D['ACCENT']}; font-size: 13px; font-weight: 700; "
            f"letter-spacing: 1px; text-transform: uppercase; "
            f"padding: 6px 0 4px 0; border-bottom: 1px solid {D['BORDER']};"
        )
        right.addWidget(log_header)

        self.log_view = QTextEdit()
        self.log_view.setReadOnly(True)
        # Native line cap — Qt handles trim inside the widget, no cursor
        # walking on the main thread every N lines like the old code did.
        self.log_view.document().setMaximumBlockCount(6000)
        # Don't rewrap long lines; a text editor rewrap on every append
        # is another main-thread cost the log stream doesn't need.
        self.log_view.setLineWrapMode(QTextEdit.NoWrap)
        right.addWidget(self.log_view, 3)

        # ── Batched stdout processing ─────────────────────────────────
        # v3 of the log path — v2 (append-buffer only) still let the
        # readyReadStandardOutput signal do decode + split + regex on
        # every burst on the main thread, which was enough to lock up
        # editing widgets (collectors list, pack combo, spinboxes) on a
        # busy parallel run.
        #
        # Now `_on_stdout` does ONLY a bytes-copy into a raw buffer and
        # returns. A 300ms QTimer does the decode / line-split / regex
        # filter / QTextEdit insert / auto-scroll in one batched pass
        # with updates disabled during the insert. Editing widgets get
        # 100% of the event loop while a run is in flight.
        self._stdout_raw_pending: bytearray = bytearray()
        self._stdout_line_tail: str = ""
        self._log_pending: list[str] = []     # kept for _append_log callers
        # Live counters parsed from stdout while a run is in flight (the
        # pool report .md is only rewritten when a run ENDS).
        self._live_tail: str = ""
        self._live = {"accounts": 0, "packs": 0, "matches": 0, "t0": None}
        self._log_flush_timer = QTimer(self)
        self._log_flush_timer.setInterval(300)      # ms — batch depth
        self._log_flush_timer.timeout.connect(self._flush_log_buffer)
        self._log_flush_timer.start()

        pool_header = QLabel("◈ ACTIVE GOD PACK POOL")
        pool_header.setStyleSheet(
            f"color: {D['GOLD']}; font-size: 13px; font-weight: 700; "
            f"letter-spacing: 1px; text-transform: uppercase; "
            f"padding: 6px 0 4px 0; border-bottom: 1px solid {D['BORDER']};"
        )
        right.addWidget(pool_header)

        self.live_label = QLabel("")
        self.live_label.setStyleSheet(
            f"color: {D['GOLD']}; font-weight: 600; padding: 4px 0;")
        right.addWidget(self.live_label)

        self.pool_view = QTextEdit()
        self.pool_view.setReadOnly(True)
        right.addWidget(self.pool_view, 2)

        pool_btn_row = QHBoxLayout()
        btn_refresh = QPushButton("Refresh pool report")
        btn_refresh.clicked.connect(self._refresh_pool)
        pool_btn_row.addWidget(btn_refresh)
        pool_btn_row.addStretch(1)
        right.addLayout(pool_btn_row)

        right_widget = QWidget()
        right_widget.setLayout(right)
        right_widget.setMinimumWidth(400)

        splitter.addWidget(left_scroll)
        splitter.addWidget(right_widget)
        # Initial split: settings panel ~420 (like the old fixed width),
        # rest goes to the log/pool panel. User can drag from here.
        splitter.setSizes([420, 900])
        # setStretchFactor(index, weight): when the WINDOW is resized, the
        # right side (index 1) grows/shrinks — the settings panel stays put
        # unless the user drags the handle themselves.
        splitter.setStretchFactor(0, 0)
        splitter.setStretchFactor(1, 1)

    def _add_section(self, layout, text):
        lbl = QLabel(text)
        lbl.setProperty("section", True)
        lbl.setStyleSheet(
            f"color: {D['ACCENT']}; font-size: 12px; font-weight: 700; "
            f"letter-spacing: 1px; text-transform: uppercase; "
            f"padding: 6px 0 2px 0; border-bottom: 1px solid {D['BORDER']};"
        )
        layout.addWidget(lbl)

    def _add_field(self, layout, label_text, widget):
        row = QVBoxLayout()
        row.setSpacing(1)
        lbl = QLabel(label_text)
        lbl.setStyleSheet(f"color: {D['TEXT3']}; font-size: 11px; padding-top: 2px;")
        row.addWidget(lbl)
        row.addWidget(widget)
        w = QWidget()
        w.setLayout(row)
        layout.addWidget(w)

    def _add_path_field(self, layout, label_text, widget, is_file=False,
                        dialog_title=""):
        """Same as _add_field but with a compact browse button on the right
        that opens a folder or file picker and drops the chosen path into
        the QLineEdit. is_file=True opens a file picker instead."""
        row = QVBoxLayout()
        row.setSpacing(1)
        lbl = QLabel(label_text)
        lbl.setStyleSheet(f"color: {D['TEXT3']}; font-size: 11px; padding-top: 2px;")
        row.addWidget(lbl)

        # Horizontal strip: [ QLineEdit ..............] [ 📁 ]
        h = QHBoxLayout()
        h.setContentsMargins(0, 0, 0, 0)
        h.setSpacing(4)
        h.addWidget(widget, 1)  # LineEdit stretches
        browse = QPushButton("📁")
        browse.setFixedWidth(30)
        browse.setMaximumHeight(24)
        browse.setToolTip(f"Browse for {label_text}")
        browse.setCursor(Qt.PointingHandCursor)

        title = dialog_title or f"Select {label_text}"

        def _on_browse():
            # Start from the current value if it exists on disk, else ROOT.
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
                # QFileDialog returns forward-slash paths on Windows too;
                # normalize to what Windows users expect visually.
                widget.setText(str(Path(chosen)))

        browse.clicked.connect(_on_browse)
        h.addWidget(browse)
        row.addLayout(h)

        w = QWidget()
        w.setLayout(row)
        layout.addWidget(w)

    # ── Collector list management ─────────────────────────────────
    def _collectors_list(self) -> list[str]:
        return [self.w_collectors.item(i).text()
                for i in range(self.w_collectors.count())]

    def _normalize_code(self, raw: str) -> str:
        """Normalize a collector code: keep UUIDs as-is, strip dashes from digit-only."""
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
            # Store in dashed form for readability
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
        # De-dupe
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

    # ── Settings load/save ────────────────────────────────────────
    def _load_settings(self):
        try:
            if SETTINGS_FILE.is_file():
                data = json.loads(SETTINGS_FILE.read_text("utf-8"))
                # Collectors — support both new list form and old single-string form
                self.w_collectors.clear()
                codes = data.get("collectors")
                if isinstance(codes, list):
                    for c in codes:
                        norm = self._normalize_code(str(c))
                        if norm:
                            self.w_collectors.addItem(QListWidgetItem(norm))
                elif "friend_code" in data:
                    # Legacy single-code migration
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
                self.w_quarantine_locked.setChecked(
                    bool(data.get("quarantine_locked", True)))
                self.w_send_likes.setChecked(bool(data.get("send_likes", False)))
                self.w_like_file.setText(data.get("like_codes_file", "like_targets.txt"))
                self.w_dismiss_popups.setChecked(
                    bool(data.get("dismiss_popups", True)))
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
                # Run mode + wishlist
                mode = str(data.get("run_mode", "godpack"))
                mi = self.w_run_mode.findData(mode)
                if mi >= 0:
                    self.w_run_mode.setCurrentIndex(mi)
                fm = str(data.get("farming_mode", "only_gp"))
                fi = self.w_farming_mode.findData(fm)
                if fi >= 0:
                    self.w_farming_mode.setCurrentIndex(fi)
                pp = str(data.get("pack_power_min", "1/5"))
                pi = self.w_pack_power_min.findData(pp)
                if pi >= 0:
                    self.w_pack_power_min.setCurrentIndex(pi)
                self.w_verbose.setChecked(bool(data.get("verbose", False)))
                self._update_mode_enabled()
        except Exception:
            pass

    def _save_settings(self):
        data = {
            "collectors": self._collectors_list(),
            "pack_id": self.w_pack.currentData(),
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
        }
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        try:
            SETTINGS_FILE.write_text(json.dumps(data, indent=2), "utf-8")
            # Only update status if this wasn't triggered by add/remove (which sets its own status)
            # But it's safe to also let add/remove overwrite this
            if not self.status_label.text().startswith(("Added", "Removed", "Already")):
                self.status_label.setText(f"Settings saved to {SETTINGS_FILE.name}.")
        except Exception as exc:
            QMessageBox.warning(self, "Save failed", str(exc))

    # ── Injection subprocess ──────────────────────────────────────
    def _build_cmd(self) -> list[str]:
        run_mode = self.w_run_mode.currentData() or "godpack"
        codes = self._collectors_list()
        if run_mode == "godpack" and not codes:
            QMessageBox.warning(
                self, "No collectors",
                "Add at least one collector friend code (16 digits or UUID), "
                "or switch Run mode to 'Open Packs Only'.",
            )
            return []
        pack_id = self.w_pack.currentData() or DEFAULT_PAID_PACK_ID
        product_id = product_id_for_pack(pack_id)
        cmd = [
            sys.executable, str(INJECT_SCRIPT),
            "--collector-codes", ",".join(codes) if codes else "dummy",
            "--worker-url", self.w_worker_url.text().strip(),  # <--- NUEVA LÍNEA AÑADIDA
            "--packs", str(self.w_packs.value()),
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
        if self.w_dry_run.isChecked():
            cmd.append("--dry-run")
        if self.w_verify_power.isChecked():
            cmd.append("--verify-power")
        # Quarantine flag — --quarantine-locked is the ON path, but since
        # argparse default is True, we always pass one of the two so the
        # subprocess never falls back to the arg default (in case that
        # default ever changes).
        if self.w_quarantine_locked.isChecked():
            cmd.append("--quarantine-locked")
        else:
            cmd.append("--no-quarantine-locked")
        if self.w_send_likes.isChecked():
            cmd.append("--send-likes")
            cmd += ["--like-codes-file",
                    self.w_like_file.text().strip() or "like_targets.txt"]
        # --dismiss-popups is BooleanOptionalAction on the inject side,
        # so we always emit one of the two forms explicitly.
        if self.w_dismiss_popups.isChecked():
            cmd.append("--dismiss-popups")
        else:
            cmd.append("--no-dismiss-popups")
        if self.w_min_hourglass.value() > 0:
            cmd += ["--min-hourglass", str(self.w_min_hourglass.value())]
        # Free packs only -> force hg_cost 0 (no hourglasses ever spent).
        # Unticked -> leave --hg-cost off so the pack catalog decides.
        if self.w_free_only.isChecked():
            cmd += ["--hg-cost", "0"]
        cmd.extend(["--fr-per-min", str(self.w_fr_per_min.value())])
        # NEW: global pack-open budget (see w_packs_per_min tooltip).
        # 0 = disabled — no need to pass the flag in that case.
        ppm = float(self.w_packs_per_min.value())
        if ppm > 0:
            cmd.extend(["--packs-per-min", str(ppm)])
        # NEW: shuffle proxy pool once at startup.
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
        """Create the like-targets file (with a hint header) if missing, then open it."""
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

    def _update_mode_enabled(self):
        """Grey out wishlist widgets in packs-only mode."""
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
        if self._community:
            return
        # El boton manda clicked(False) como cmd_override: solo una lista (limpieza) NO es un Start normal.
        comunidad = self.w_community.isChecked() and not isinstance(cmd_override, list)
        propias = bool(self.w_xml_dir.text().strip() or self.w_accounts_dir.text().strip())
        if comunidad and not propias:
            self._start_community(limpiar=True)   # sin carpeta propia: solo las prestadas
            return
        # clicked(bool) passes False into the first arg - guard against it
        cmd = cmd_override if isinstance(cmd_override, list) else self._build_cmd()
        if not cmd:
            return
        self._save_settings()  # persist current values before running

        # Tee inject.py's log to a file. On Windows, also spawn a PowerShell
        # window that tails it live — so the user sees the full raw stream
        # like auto_trade does.
        log_dir = ROOT / "reports"
        log_dir.mkdir(parents=True, exist_ok=True)
        log_path = log_dir / "god_pack_live.log"
        # Truncate before start so old content doesn't leak into the new run
        try:
            log_path.write_text("", encoding="utf-8")
        except Exception:
            pass
        cmd = cmd + ["--log-file", str(log_path)]

        # Graceful-stop plumbing: generate a unique marker file path and pass
        # it to inject.py. When the user clicks Stop, we touch this file
        # (see _stop_injection). inject.py's stop-file watcher notices and
        # sets its stop-event so the between-account loop breaks out AFTER
        # the current account finishes its cleanup (unfriend, register JSON,
        # close session). This is portable across Windows/Linux — QProcess
        # .terminate() alone is unreliable on Windows console processes.
        stop_dir = ROOT / "reports" / "stop_requests"
        stop_dir.mkdir(parents=True, exist_ok=True)
        self._stop_f = stop_dir / f"stop_god_pack_{uuid.uuid4().hex[:8]}.txt"
        # Ensure no stale stop file survives from a previous run.
        try:
            if self._stop_f.exists():
                self._stop_f.unlink()
        except Exception:
            pass
        cmd = cmd + ["--stop-file", str(self._stop_f)]

        self.log_view.clear()
        # Reset the batched-log state so anything left over from a prior
        # run doesn't bleed into the fresh session's first flush.
        self._stdout_raw_pending.clear()
        self._stdout_line_tail = ""
        self._live_tail = ""
        self._live = {"accounts": 0, "packs": 0, "matches": 0, "t0": time.time()}
        self._update_live_label(running=True)
        self._log_pending = []
        self._append_log(f"[gui] launching: {' '.join(cmd)}\n")
        self._append_log(f"[gui] raw log: {log_path}\n")

        self._spawn_powershell_tail(log_path)

        self.proc = QProcess(self)
        self.proc.setProcessChannelMode(QProcess.MergedChannels)
        env = QProcessEnvironment.systemEnvironment()
        # Route through local uTLS proxy tunnel (same as main flow)
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
        self.btn_stop.setText("Stop")
        self.status_label.setText("Running.")

        #  CÓDIGO DEL PPM ──
        from threading import Thread
        from scripts.god_pack.ppm_monitor import start_ppm_loop

        current_pack_name = self.w_pack.currentText()
        interval_mins = self.w_ppm_interval.value() if hasattr(self, "w_ppm_interval") else 5

        self._save_settings()  # discord_notifier lee webhook/mencion de settings.json
        # Un solo reporte de PPM por panel: el de un Start anterior se apaga antes de arrancar el
        # nuevo (bug real 2026-10-31: cada Start dejaba otro hilo vivo y llegaban dos heartbeats,
        # uno en 0 y otro con los sobres reales).
        from threading import Event
        if getattr(self, "_ppm_stop", None) is not None:
            self._ppm_stop.set()
        self._ppm_stop = Event()
        # Con Community farm el PPM lo manda el bot de Monitor Pokemon (tus sobres + los prestados):
        # si tambien lo mandara el panel llegarian dos heartbeats con el mismo nombre.
        if comunidad:
            self._start_community(limpiar=False)
        webhook_target = "" if comunidad else self.w_ppm_webhook.text().strip()
        if webhook_target:
            Thread(target=start_ppm_loop, args=(webhook_target, current_pack_name, interval_mins,
                                                self.w_host_name.text().strip() or "Host", self._ppm_stop),
                   daemon=True).start()

    def _spawn_powershell_tail(self, log_path):
        """Open a new PowerShell window that tails the raw log, so the user
        sees everything the GUI filter hides. Windows-only; silently skipped
        elsewhere. Uses subprocess.Popen with CREATE_NEW_CONSOLE."""
        if sys.platform != "win32":
            return
        try:
            import subprocess
            CREATE_NEW_CONSOLE = 0x00000010
            # -NoExit keeps the window open after the tail command finishes;
            # -Command runs Get-Content -Wait (equivalent to `tail -f`) with
            # a title we set first via $host.UI.RawUI.WindowTitle.
            ps_cmd = (
                f"$host.UI.RawUI.WindowTitle = 'God Pack Injection - Live Log'; "
                f"Write-Host '=== tailing: {log_path} ===' -ForegroundColor Cyan; "
                f"Get-Content -Wait -Path '{log_path}'"
            )
            subprocess.Popen(
                ["powershell.exe", "-NoExit", "-Command", ps_cmd],
                creationflags=CREATE_NEW_CONSOLE,
            )
        except Exception as exc:
            self._append_log(f"[gui] couldn't spawn PowerShell tail window: {exc}\n")

    # Safety net only: if the process is STILL alive this long after Stop,
    # something is hung. Anything not cleaned stays in reports/fr_ledger.json
    # and is swept at the next start (or via "Clean up leftover friend requests").
    STOP_SAFETY_KILL_MS = 20 * 60 * 1000

    def _stop_injection(self):
        """
        1st click: graceful stop. Writes the marker file; inject.py finishes
        the current account's cleanup, then runs the FINAL SWEEP (every
        account still in the FR ledger gets pending FRs cancelled and
        accepted friends deleted) and exits by itself.
        2nd click: force kill (asks first).

        No QProcess.terminate() any more: on Windows it does nothing for
        console processes, and the stop file is the reliable path.
        """
        if self._community:
            self._stop_community()
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
                "sweeping ALL leftover friend requests before exit. "
                "Don't close the window until it says 'process finished'.\n")
        except Exception as exc:
            self._append_log(f"[gui] failed to write stop file: {exc}\n")

        self.btn_stop.setText("Force Kill")
        self.status_label.setText(
            "Stopping - cleaning up friend requests (Force Kill only if stuck)...")
        run_id = self._run_id
        QTimer.singleShot(self.STOP_SAFETY_KILL_MS,
                          lambda: self._safety_kill(run_id))

    def _safety_kill(self, run_id: int):
        # Ignore timers from an earlier run (the old 90s timer could kill
        # the NEXT run if you restarted quickly).
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
                "be cleaned on the next Start, or with 'Clean up leftover friend "
                "requests'.\n\nKill anyway?")
            if r != QMessageBox.Yes:
                return
        self.proc.kill()
        self._append_log("[gui] force-killed - leftovers stay in reports/fr_ledger.json "
                         "and will be swept on next start\n")

    def closeEvent(self, event):
        """Closing the window used to kill inject.py instantly (QProcess dies
        with its parent) - no cleanup at all. Now: request a graceful stop and
        close once the process has finished its sweep."""
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

    # Compiled once. Lines matching any of these show in the GUI when
    # "Show verbose" is OFF. Everything else is filtered out but still
    # streams to the PowerShell tail window we spawn on Start, so the raw
    # firehose is one window away.
    #
    # Kept minimal on purpose: pack outcomes + run frame + fatal errors.
    # Toggle "Show verbose" for the full stream inside the GUI.
    _GUI_LINE_PATTERNS = re.compile(
        r"("
        # Pack outcomes — cards pulled + pack opened is the whole point
        r"pack opened cards="
        r"|cards: "
        r"|-- ACCOUNT SUMMARY:"
        r"|\[MATCH\]"
        r"|GOD PACK "
        r"|god pack drawn but UNPICKABLE"
        r"|<-- RARE PACK|<-- rare "
        # Threshold verdict (from inject.py's diagnostic log)
        r"|\[threshold\] "
        # Safety-net FR cleanup (worth seeing at-a-glance)
        r"|\[cleanup\] "
        r"|\[fr-cleanup\] |\[fr-sweep\] |\[stop-signal\] "
        # Pre-flight steps added on 2026-09-28: popup dismiss, hourglass
        # gate, showcase like. Users should see these in the GUI log so
        # a silent no-op vs a live action is obvious.
        r"|\[popup\] |\[hourglass\] |\[like\] "
        # Diagnostic when the rarity-based god-pack fallback fires (the
        # server's table_id didn't end in _02 but the pack was god-shape)
        r"|\[classify-fallback\] "
        # Free-power / hourglass cap decision (why 10 became N)
        r"|capping packs |paid pack mix:|\[pack \d+/\d+\] FREE"
        # Verified pack-power report so the user can spot a 0-power skip
        r"|verify_power: server reports"
        # Hourglass hint the runtime prints when --packs > 2
        r"|\[hint\] --packs"
        # Why an account opened 0/N: proxy health check, RPC failures,
        # and the "did NOT open" line. These used to be hidden, which made
        # a dead proxy look like a counting bug.
        r"|\[proxy-health\]|\[!\] GetPackPowerV1 failed"
        r"|\[!\] Pack/GetDetailV2 failed|\[!\] PurchaseV2 failed"
        r"|verify_power: RPC failed|did NOT open"
        # Run frame — one line at start, one at end, plus the report link
        r"|starting: accounts="
        r"|DONE - "
        r"|pool report:"
        # Fatal errors only — anything the user MUST see even in quiet mode
        r"|^Traceback"
        r"|\[X\] "
        r"|\[!\] stop requested"
        r")"
    )

    # ── Community farm (COMMUNITY_FARM_V1) ───────────────────────
    # El bot de Monitor Pokemon lee reports/community_farm.json: {"on": true, "ts": ms}. Lo
    # renovamos cada 30 s mientras esta en Start; si el panel se cierra o se cuelga, a los 2 min
    # sin renovar el bot lo da por apagado. reports/community_farm.stop corta la tanda en curso
    # (inject.py lo recibe como --stop-file y termina la cuenta actual con su limpieza).
    COMMUNITY_FILE = ROOT / "reports" / "community_farm.json"
    COMMUNITY_STOP = ROOT / "reports" / "community_farm.stop"
    COMMUNITY_LOG = ROOT / "reports" / "reroll_comunidad.log"

    def _community_mark(self, on: bool):
        try:
            self.COMMUNITY_FILE.parent.mkdir(parents=True, exist_ok=True)
            self.COMMUNITY_FILE.write_text(
                json.dumps({"on": bool(on), "ts": int(time.time() * 1000),
                            "own": int(getattr(self, "_own_count", 0))}), encoding="utf-8")
        except Exception as exc:
            self._append_log(f"[gui] couldn't write {self.COMMUNITY_FILE.name}: {exc}\n")

    def _own_accounts(self) -> int:
        """Cuantas cuentas propias (XML) hay en las carpetas del panel, para el recuadro de Discord."""
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
            self._live = {"accounts": 0, "packs": 0, "matches": 0, "t0": time.time()}
            self._update_live_label(running=True)
            self._log_pending = []
        self._append_log("[gui] Community farm ON - your Monitor Pokemon bot opens the accounts members "
                         "lend through Monitor Link. First batch within a minute, then every 10 min.\n"
                         "[gui] Stop (or closing this window) turns it off.\n")
        self._community_timer = QTimer(self)
        self._community_timer.timeout.connect(self._community_tick)
        self._community_timer.start(1000)
        self._community_beat = QTimer(self)
        self._community_beat.timeout.connect(lambda: self._community_mark(True))
        self._community_beat.start(30000)
        self.btn_start.setEnabled(False)
        self.btn_cleanup.setEnabled(False)
        self.btn_stop.setEnabled(True)
        self.btn_stop.setText("Stop")
        self.w_community.setEnabled(False)
        self.status_label.setText("Community farm running.")

    def _community_tick(self):
        """Lleva las lineas nuevas de reroll_comunidad.log al Live Log (mismo filtro y contadores)."""
        try:
            size = self.COMMUNITY_LOG.stat().st_size
            if size < self._community_pos:   # el bot roto el log (> 20 MB)
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
        for nombre in ("_community_timer", "_community_beat"):
            timer = getattr(self, nombre, None)
            if timer is not None:
                timer.stop()
        self._community_tick()
        self._append_log("\n[gui] Community farm OFF - the account in progress finishes its cleanup, "
                         "then this host stops farming.\n")
        self.w_community.setEnabled(True)
        # Si tus cuentas siguen corriendo (Stop las corta con su limpieza), los botones los maneja ese flujo.
        if self.proc is None or self.proc.state() == QProcess.NotRunning:
            self.btn_start.setEnabled(True)
            self.btn_cleanup.setEnabled(True)
            self.btn_stop.setEnabled(False)
            self.status_label.setText("Idle (Community farm stopped).")
            self._update_live_label(running=False)
            self._refresh_pool()

    def _on_stdout(self):
        """
        Fires on every stdout burst from QProcess. Kept absolutely
        minimal so it can't jam the event loop: read the pending bytes
        into a bytearray and return. All decode/filter/insert work
        happens in the 300ms timer tick.
        """
        if self.proc is None:
            return
        try:
            self._stdout_raw_pending.extend(bytes(self.proc.readAllStandardOutput()))
        except Exception:
            pass

    def _on_finished(self, code, _status):
        self._append_log(f"\n[gui] process finished exit_code={code}\n")
        self._stopping = False
        self.btn_start.setEnabled(True)
        self.btn_cleanup.setEnabled(True)
        self.btn_stop.setEnabled(False)
        self.btn_stop.setText("Stop")
        self.status_label.setText(f"Idle (last exit: {code}).")
        if self._community:
            # Tus cuentas terminaron, pero el Community farm sigue hasta que le des Stop.
            self.btn_start.setEnabled(False)
            self.btn_cleanup.setEnabled(False)
            self.btn_stop.setEnabled(True)
            self.status_label.setText("Your accounts are done - Community farm still running (Stop to end).")
        # Clean up the stop file so it doesn't leak into a subsequent run.
        # (Belt-and-braces: _start_injection also unlinks any stale file.)
        stop_path = getattr(self, "_stop_f", None)
        if stop_path:
            try:
                if stop_path.exists():
                    stop_path.unlink()
            except Exception:
                pass
        self._update_live_label(running=False)
        self._refresh_pool()
        if self._close_after_finish:
            QTimer.singleShot(300, self.close)

    def _append_log(self, text: str):
        """
        Public entry — queues text for the next scheduled flush. Called
        by GUI code (start / stop messages, etc). Subprocess stdout uses
        the raw byte path via _on_stdout instead.
        """
        if not text:
            return
        self._log_pending.append(text)

    def _flush_log_buffer(self):
        """
        Runs on the 300ms QTimer. In ONE main-thread pass:
          1. Decode any pending raw stdout bytes.
          2. Split into lines using the retained tail from last tick.
          3. Filter by regex (unless "verbose" is on).
          4. Append the survivors + any queued _log_pending text.
          5. Auto-scroll to bottom only if the user was already there.

        Uses setUpdatesEnabled(False) so the QTextEdit repaints once at
        the end instead of per-insert. Cheap when there's nothing to
        do; returns immediately.
        """
        # 1-3: decode + filter subprocess stdout, if any queued.
        stdout_text = ""
        if self._stdout_raw_pending:
            try:
                raw_str = bytes(self._stdout_raw_pending).decode(
                    "utf-8", errors="replace")
            except Exception:
                raw_str = ""
            self._stdout_raw_pending.clear()

            if raw_str:
                self._count_live(raw_str)
                if self.w_verbose.isChecked():
                    stdout_text = raw_str
                else:
                    buf = self._stdout_line_tail + raw_str
                    lines = buf.split("\n")
                    self._stdout_line_tail = lines[-1]
                    kept = [ln for ln in lines[:-1]
                             if self._GUI_LINE_PATTERNS.search(ln)]
                    if kept:
                        stdout_text = "\n".join(kept) + "\n"

        # 4-5: nothing new? bail without touching the widget.
        if not stdout_text and not self._log_pending:
            return

        combined = stdout_text
        if self._log_pending:
            combined += "".join(self._log_pending)
            self._log_pending = []

        self.log_view.setUpdatesEnabled(False)
        try:
            cursor = self.log_view.textCursor()
            cursor.movePosition(QTextCursor.End)
            cursor.insertText(combined)
            bar = self.log_view.verticalScrollBar()
            at_bottom = bar.value() >= bar.maximum() - 4
            if at_bottom:
                bar.setValue(bar.maximum())
        finally:
            self.log_view.setUpdatesEnabled(True)

    # ── Live counters ─────────────────────────────────────────────
    def _count_live(self, raw_str: str):
        buf = self._live_tail + raw_str
        lines = buf.split("\n")
        self._live_tail = lines[-1]
        changed = False
        for ln in lines[:-1]:
            if "pack opened cards=" in ln:
                self._live["packs"] += 1
                changed = True
            if "-- ACCOUNT SUMMARY:" in ln:
                self._live["accounts"] += 1
                if "MATCH:" in ln:
                    self._live["matches"] += 1
                changed = True
        if changed:
            self._update_live_label(running=True)

    def _update_live_label(self, running: bool = False):
        t0 = self._live.get("t0")
        if t0 is None:
            self.live_label.setText("")
            return
        mins = (time.time() - t0) / 60.0
        state = "LIVE (this run)" if running else "LAST RUN (final)"
        self.live_label.setText(
            f"{state}: {self._live['accounts']} accounts | "
            f"{self._live['packs']} packs | "
            f"{self._live['matches']} matches | {mins:.1f} min"
            + ("   - the report below updates when the run ends"
               if running else ""))

    # ── Pool viewer ───────────────────────────────────────────────
    def _refresh_pool(self):
        if POOL_REPORT.is_file():
            try:
                text = POOL_REPORT.read_text("utf-8")
                self.pool_view.setPlainText(text)
            except Exception as exc:
                self.pool_view.setPlainText(f"(failed to read pool report: {exc})")
        else:
            self.pool_view.setPlainText(
                "(no pool report yet — will appear after first injection run)")


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