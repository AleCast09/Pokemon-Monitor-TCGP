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


class NoScrollSpinBox(QSpinBox):
    def wheelEvent(self, event):
        event.ignore()


class NoScrollDoubleSpinBox(QDoubleSpinBox):
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
        self._events_count = {"hits": 0, "errors": 0}

        self._build_ui()
        self._load_settings()

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
        header_row.addLayout(title_box, 1)

        self.badge_status = QLabel("● IDLE")
        self.badge_status.setStyleSheet(
            f"background: {D['CARD']}; color: {D['TEXT2']}; border: 1px solid {D['BORDER2']}; "
            f"border-radius: 11px; padding: 4px 12px; font-size: 11px; font-weight: 800;"
        )
        header_row.addWidget(self.badge_status, 0, Qt.AlignRight | Qt.AlignVCenter)
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
        pool_header = QLabel("✨ LIVE GOD PACK HITS & CRITICAL ALERTS")
        pool_header.setStyleSheet(
            f"color: {D['GOLD']}; font-size: 12px; font-weight: 800; letter-spacing: 1px;"
        )
        pool_top_bar.addWidget(pool_header)
        pool_top_bar.addStretch(1)

        self.live_label = QLabel("0 Hits · 0 Alerts")
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
        self.w_run_mode = QComboBox()
        self.w_run_mode.addItem("God Pack Farming (Send FR + Wishlist Match)", "godpack")
        self.w_run_mode.addItem("Open Packs Only (No FR, No Wishlist)", "packs-only")
        self.w_run_mode.currentIndexChanged.connect(self._update_mode_enabled)
        self._add_field(l_pack, "Run Mode", self.w_run_mode)

        self.w_pack = QComboBox()
        for pack in paid_pack_options():
            label = f"[{pack.get('sku_id', '?')}] {pack.get('name', '?')} — {pack['pack_id']}"
            self.w_pack.addItem(label, pack["pack_id"])
        default_idx = max(0, self.w_pack.findData(DEFAULT_PAID_PACK_ID))
        self.w_pack.setCurrentIndex(default_idx)
        self._add_field(l_pack, "Pack to Open", self.w_pack)

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
        self.w_farming_mode = QComboBox()
        self.w_farming_mode.addItem("Only GP (99% of members)", "only_gp")
        self.w_farming_mode.addItem("GP & Double (2xSR normal packs too)", "gp_double")
        self.w_farming_mode.addItem("GP & Single or Double (1xSR or 2xSR normal packs)", "gp_single")
        self._add_field(l_wish, "Farming Mode", self.w_farming_mode)

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
        self.w_pack_power_min.setCurrentIndex(2)
        self._add_field(l_wish, "Pack Power Minimum Threshold", self.w_pack_power_min)
        lay.addWidget(c_wish)

        c_flags, l_flags = self._make_card("⚙️ Quick Run Toggles")
        self.w_free_only = QCheckBox("Free packs only — never spend hourglasses")
        self.w_free_only.setChecked(False)
        l_flags.addWidget(self.w_free_only)

        self.w_community = QCheckBox("Community Farm — also open lent accounts (Monitor Link)")
        self.w_community.setChecked(True)
        l_flags.addWidget(self.w_community)

        self.w_dry_run = QCheckBox("Dry run (test flow without opening packs)")
        l_flags.addWidget(self.w_dry_run)
        lay.addWidget(c_flags)

        lay.addStretch(1)
        self.tabs.addTab(page, "🎯 Farm & Pack")

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
        self.tabs.addTab(page, "👥 Collectors & Discord")

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
        self.w_cooldown.setRange(0.5, 168.0)
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

        self.w_sort_order = QComboBox()
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

        self.w_proxy_scheme = QComboBox()
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
        self.tabs.addTab(page, "⚡ Timing & Proxies")

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
        self.tabs.addTab(page, "📂 Paths & Safety")

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
        pack_id = self.w_pack.currentData() or DEFAULT_PAID_PACK_ID
        product_id = product_id_for_pack(pack_id)
        cmd = [
            sys.executable, str(INJECT_SCRIPT),
            "--collector-codes", ",".join(codes) if codes else "dummy",
            "--worker-url", worker_url,
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

        self.log_view.clear()
        self._stdout_raw_pending.clear()
        self._stdout_line_tail = ""
        self._live_tail = ""
        self._last_pack_line.clear()
        self._pending_hit_header.clear()
        self._live = {"accounts": 0, "packs": 0, "matches": 0, "errors": 0, "t0": time.time()}
        self._own_total = 0; self._own_done = 0; self._own_opened = 0
        self._update_live_label(running=True)
        self._log_pending = []
        self._append_log(f"[gui] launching: {' '.join(cmd)}\n")
        self._append_log(f"[gui] raw log: {log_path}\n")

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
        if comunidad:
            self._start_community(limpiar=False)
        webhook_target = "" if comunidad else self.w_ppm_webhook.text().strip()
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
        self.btn_start.setEnabled(False)
        self.btn_cleanup.setEnabled(False)
        self.btn_stop.setEnabled(True)
        self.btn_stop.setText("■  STOP")
        self.w_community.setEnabled(False)
        self.status_label.setText("Community farm running.")
        self._set_badge("COMMUNITY", D["CYAN"])

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
        for nombre in ("_community_timer", "_community_beat"):
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
        try:
            self.stat_left._val_label.setText(f"{own_left + lent_left:,} | {self._own_opened + lent_opened:,}")
        except Exception:
            pass

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
            if "pack opened cards=" in ln:
                self._live["packs"] += 1
                self._last_pack_line[tag] = ln
                changed = True
                # SOLO registrar en el panel inferior si es un GOD PACK real
                # (Ignora <-- RARE PACK y <-- rare de 1 o 2 estrellas normales)
                if "GOD PACK" in ln:
                    self._pending_hit_header[tag] = ln

            elif "cards: " in ln and tag in self._pending_hit_header:
                header_ln = self._pending_hit_header.pop(tag)
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
            self.live_label.setText(f"{self._events_count['hits']} Hits · {self._events_count['errors']} Alerts")
            return
        mins = max(0.01, (time.time() - t0) / 60.0)
        ppm = self._live["packs"] / mins if mins > 0 else 0.0

        # Update top KPI cards
        self.stat_accounts._val_label.setText(str(self._live["accounts"]))
        self.stat_packs._val_label.setText(str(self._live["packs"]))
        self.stat_matches._val_label.setText(str(self._live["matches"]))
        self.stat_ppm._val_label.setText(f"{mins:.1f}m | {ppm:.1f} PPM")

        self.live_label.setText(
            f"🌟 {self._events_count['hits']} Hits  ·  🚨 {self._events_count['errors']} Alerts"
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