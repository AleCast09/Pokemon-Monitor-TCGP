#!/usr/bin/env python3
import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Callable, List, Optional, Tuple

import requests
from google.protobuf.json_format import MessageToDict
from PIL import Image, ImageDraw


PROJECT_ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = PROJECT_ROOT / ".card_image_cache"
RENDERS_DIR = PROJECT_ROOT / "reports" / "gp_renders"
SETTINGS_FILE = PROJECT_ROOT / "tools" / "god_pack_gui" / "settings.json"


def _config_discord() -> tuple[str, str]:
    """Ale 2026-10-30: webhook y mencion salen del panel (settings.json), no del codigo."""
    try:
        data = json.loads(SETTINGS_FILE.read_text("utf-8"))
        webhook, mencion = str(data.get("gp_webhook") or "").strip(), str(data.get("mention_id") or "").strip()
    except Exception:
        webhook, mencion = "", ""
    # 2026-11-06 (Ale): empty panel webhook -> the community one (the staff sets it in 🔒-hosts; the Monitor
    # Pokemon bot writes it here), so every host's God Packs reach KyuremBot.
    if not webhook:
        try:
            webhook = (PROJECT_ROOT / "reports" / "community_gp_webhook.txt").read_text("utf-8").strip()
        except Exception:
            webhook = ""
    return webhook, mencion

PACK_TAG_MAP = {
    "BN011_0010_00_000": "DeluxeB",
    "BN010_0010_00_000": "RocketA",
    "BN001_0030_00_000": "MegaAltaria",
    "BN001_0010_00_000": "Charizard",
    "BN001_0020_00_000": "Mewtwo",
    "BN001_0040_00_000": "Pikachu",
    "CN001_0010_00_000": "DualMewtwo",  # <-- Nueva expansión
    "CN001_0020_00_000": "DualPikachu",    # <-- Nueva expansión
}

_cache_lock = threading.Lock()
_image_index: dict[str, Path] = {}
_remote_filename_map: dict[str, str] = {}
_indexed_once = False
_remote_map_loaded = False

_LOCAL_SEARCH_DIRS = [
    CACHE_DIR,
    PROJECT_ROOT / "statics",
    PROJECT_ROOT / "assets",
    Path(r"D:\TCGP_BOTS"),
    Path(r"C:\TCGP_BOTS"),
    Path(r"D:\PTCGPB-leannew"),
    Path(r"C:\Headless\Cartas\cartas_C1"),
]


def _extract_pk_prefix(stem: str) -> str:
    s = stem[1:] if stem.startswith("c") and len(stem) > 3 and stem[1:3] in ("PK", "TR") else stem
    parts = s.split("_")
    if len(parts) >= 4 and parts[0] in ("PK", "TR"):
        return "_".join(parts[:4])
    return s


def _ensure_cache_indexed() -> None:
    global _indexed_once
    with _cache_lock:
        if _indexed_once:
            return
        _indexed_once = True
        for base_dir in _LOCAL_SEARCH_DIRS:
            if not base_dir.is_dir():
                continue
            try:
                for p in base_dir.rglob("*"):
                    if p.is_file() and p.suffix.lower() in (".png", ".webp", ".jpg", ".jpeg"):
                        stem = p.stem
                        pk_id = _extract_pk_prefix(stem)
                        _image_index[stem] = p
                        _image_index[stem.lower()] = p
                        _image_index[pk_id] = p
                        _image_index[pk_id.lower()] = p
            except Exception:
                continue


def _load_remote_image_catalog() -> None:
    global _remote_map_loaded
    with _cache_lock:
        if _remote_map_loaded:
            return
        _remote_map_loaded = True

        for p in PROJECT_ROOT.rglob("*.json"):
            try:
                text = p.read_text(encoding="utf-8", errors="ignore")
                for match in re.findall(r'(c?(?:PK|TR)_[0-9]{2}_[0-9]{6}_[0-9]{2}[A-Za-z0-9_]*\.(?:webp|png))', text):
                    pk_id = _extract_pk_prefix(match.rsplit(".", 1)[0])
                    _remote_filename_map[pk_id] = match
            except Exception:
                continue

        catalog_urls = [
            "https://raw.githubusercontent.com/marcelpanse/tcgp-data/main/cards.json",
            "https://raw.githubusercontent.com/PTCGPB/PTCGPB-Helper/main/statics/cards.json",
            "https://pokemon-zone.com/api/cards",
        ]
        for url in catalog_urls:
            try:
                r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=6)
                if r.status_code == 200:
                    for match in re.findall(r'(c?(?:PK|TR)_[0-9]{2}_[0-9]{6}_[0-9]{2}[A-Za-z0-9_]*\.(?:webp|png))', r.text):
                        pk_id = _extract_pk_prefix(match.rsplit(".", 1)[0])
                        _remote_filename_map[pk_id] = match
            except Exception:
                continue


def _find_card_image(card_id: str) -> Optional[Path]:
    _ensure_cache_indexed()
    cid = str(card_id or "").strip()
    if not cid:
        return None

    if cid in _image_index:
        return _image_index[cid]
    if cid.lower() in _image_index:
        return _image_index[cid.lower()]

    _load_remote_image_catalog()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    save_path = CACHE_DIR / f"{cid}.webp"

    candidates = []
    if cid in _remote_filename_map:
        full_name = _remote_filename_map[cid]
        candidates.extend([
            f"https://assets.pokemon-zone.com/game-assets/CardPreviews/{full_name}",
            f"https://assets.pokemon-zone.com/game-assets/CardNew/{full_name}",
        ])

    candidates.extend([
        f"https://assets.pokemon-zone.com/game-assets/CardPreviews/c{cid}.webp",
        f"https://assets.pokemon-zone.com/game-assets/CardPreviews/{cid}.webp",
    ])

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://www.pokemon-zone.com/",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    }

    for url in candidates:
        try:
            resp = requests.get(url, headers=headers, timeout=6)
            if resp.status_code == 200 and len(resp.content) > 1000 and b"<html" not in resp.content[:200].lower():
                save_path.write_bytes(resp.content)
                with _cache_lock:
                    _image_index[cid] = save_path
                return save_path
        except Exception:
            continue

    return None


def _normalize_pack_tier(pack_label: str, card_ids: List[str]) -> str:
    lbl = str(pack_label or "").strip().lower()
    if re.match(r"^[1-5]/[45]$", lbl):
        num = lbl.split("/")[0]
        return f"{num}/5"
    if "rare-1sr" in lbl or lbl.startswith("0/"):
        return "1/5"
    if "rare-2sr" in lbl:
        return "2/5"

    try:
        from scripts.god_pack import cards as gp_cards
        two_stars = sum(1 for c in card_ids if gp_cards.info(c).rarity in ("SR", "SAR", "IM", "S", "SSR", "UR"))
        tier = min(5, max(1, two_stars))
        return f"{tier}/5"
    except Exception:
        return "1/5"


def _fetch_live_profile_from_server(sess) -> Tuple[str, str]:
    """
    Llama directamente a PlayerProfile/MyProfileV1 (y Friend/ListV1 como respaldo)
    para obtener el Nickname real en juego (ej. VX028289) y el Friend ID de 16 dígitos.
    """
    if sess is None:
        return "", ""

    nickname = ""
    friend_id = ""

    def _scan_any_dict(d):
        nonlocal nickname, friend_id
        if not isinstance(d, dict):
            return
        for k, v in d.items():
            kl = k.lower()
            if isinstance(v, (str, int)):
                sv = str(v).strip()
                if not nickname and kl in ("nickname", "player_name", "playername", "name"):
                    if sv and not sv.startswith("141P_") and not sv.startswith("142P_"):
                        nickname = sv
                if not friend_id:
                    digits = "".join(c for c in sv if c.isdigit())
                    if len(digits) == 16 and ("friend" in kl or "code" in kl or "id" in kl or "search" in kl):
                        friend_id = digits
            elif isinstance(v, dict):
                _scan_any_dict(v)
            elif isinstance(v, list):
                for item in v:
                    if isinstance(item, dict):
                        _scan_any_dict(item)

    # 1. Llamada oficial a PlayerProfile/MyProfileV1 (línea 786 de session.py)
    try:
        from engine.takasho.schema.lettuce_server.player_api import my_profile_v1_pb2
        resp = sess._call(
            "/takasho.schema.lettuce_server.player_api.PlayerProfile/MyProfileV1",
            my_profile_v1_pb2.MyProfileV1.Types.Request(),
            my_profile_v1_pb2.MyProfileV1.Types.Response,
        )
        p = resp.profile
        if hasattr(p, "profile_spine") and getattr(p.profile_spine, "nickname", ""):
            nickname = str(p.profile_spine.nickname).strip()

        p_dict = MessageToDict(resp, preserving_proto_field_name=True)
        _scan_any_dict(p_dict)

        # Si el campo de 16 dígitos tiene otro nombre en el proto, extraer cualquier cadena de 16 dígitos
        if not friend_id:
            raw_json_str = json.dumps(p_dict)
            m16 = re.search(r'"([0-9]{16})"', raw_json_str)
            if m16:
                friend_id = m16.group(1)
    except Exception:
        pass

    # 2. Respaldo: OtherPlayerProfileV1 con nuestro propio player_id
    if (not nickname or not friend_id) and getattr(sess, "player_id", None):
        try:
            from engine.takasho.schema.lettuce_server.player_api import other_player_profile_v1_pb2
            resp2 = sess._call(
                "/takasho.schema.lettuce_server.player_api.PlayerProfile/OtherPlayerProfileV1",
                other_player_profile_v1_pb2.OtherPlayerProfileV1.Types.Request(player_id=sess.player_id),
                other_player_profile_v1_pb2.OtherPlayerProfileV1.Types.Response,
            )
            p2_dict = MessageToDict(resp2, preserving_proto_field_name=True)
            _scan_any_dict(p2_dict)
            if not friend_id:
                m16 = re.search(r'"([0-9]{16})"', json.dumps(p2_dict))
                if m16:
                    friend_id = m16.group(1)
        except Exception:
            pass

    # 3. Respaldo: Friend/ListV1 (a veces devuelve my_friend_id en la raíz del response)
    if not friend_id:
        try:
            from engine.takasho.schema.lettuce_server.player_api import friend_list_v1_pb2
            resp3 = sess._call(
                "/takasho.schema.lettuce_server.player_api.Friend/ListV1",
                friend_list_v1_pb2.FriendListV1.Types.Request(),
                friend_list_v1_pb2.FriendListV1.Types.Response,
            )
            p3_dict = MessageToDict(resp3, preserving_proto_field_name=True)
            for k, v in p3_dict.items():
                if isinstance(v, str):
                    digits = "".join(c for c in v if c.isdigit())
                    if len(digits) == 16:
                        friend_id = digits
                        break
        except Exception:
            pass

    return nickname, friend_id


def _resolve_clean_metadata(account: dict, sess=None) -> Tuple[str, str, str]:
    xml_path = account.get("xml_path") or ""
    acct_key = str(account.get("account_key") or account.get("stem") or "")
    xml_filename = Path(xml_path).name if xml_path else (f"{acct_key}.xml" if acct_key else "account.xml")

    # 1. Consultar en vivo al servidor mediante MyProfileV1
    nickname, friend_id_16 = _fetch_live_profile_from_server(sess)

    # 2. Si faltó alguno, revisar el JSON local de la cuenta
    json_path = account.get("json_path", "")
    if (not nickname or not friend_id_16) and json_path and Path(json_path).is_file():
        try:
            raw_text = Path(json_path).read_text(encoding="utf-8")
            jdata = json.loads(raw_text)

            def _scan_local(d):
                nonlocal nickname, friend_id_16
                if not isinstance(d, dict):
                    return
                for k, v in d.items():
                    kl = k.lower()
                    if isinstance(v, (str, int)):
                        sv = str(v).strip()
                        if not nickname and kl in ("nickname", "playername", "player_name", "username", "ign"):
                            if sv and sv != acct_key and not sv.startswith("141P_") and not sv.startswith("142P_"):
                                nickname = sv
                        if not friend_id_16 and ("friend" in kl or "code" in kl or "search" in kl):
                            digits = "".join(c for c in sv if c.isdigit())
                            if len(digits) == 16:
                                friend_id_16 = digits
                    elif isinstance(v, dict):
                        _scan_local(v)

            _scan_local(jdata)
        except Exception:
            pass

    # Si encontró el código de amigo real en el servidor, lo guardamos en el JSON local para futuras consultas
    if json_path and Path(json_path).is_file() and (nickname or friend_id_16):
        try:
            jdata = json.loads(Path(json_path).read_text(encoding="utf-8"))
            if isinstance(jdata, dict):
                meta = jdata.setdefault("metadata", {})
                if isinstance(meta, dict):
                    if nickname:
                        meta["nickname"] = nickname
                    if friend_id_16:
                        meta["friendId"] = friend_id_16
                    Path(json_path).write_text(json.dumps(jdata, indent=2, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass

    if not nickname:
        raw_nick = str(account.get("nickname") or "").strip()
        nickname = raw_nick if (raw_nick and raw_nick != acct_key) else acct_key

    if not friend_id_16:
        friend_id_16 = str(account.get("account_id") or "0000000000000000")

    return nickname, friend_id_16, xml_filename


def _build_pack_collage(card_ids: List[str], out_filename: str) -> Path:
    CARD_W, CARD_H, GAP = 366, 512, 14
    BG_COLOR = (11, 16, 36, 255)

    card_images = []
    for cid in card_ids:
        img_path = _find_card_image(cid)
        loaded = None
        if img_path:
            try:
                loaded = Image.open(img_path).convert("RGBA").resize((CARD_W, CARD_H), Image.Resampling.LANCZOS)
            except Exception:
                pass
        if loaded is None:
            loaded = Image.new("RGBA", (CARD_W, CARD_H), (28, 36, 68, 255))
            draw = ImageDraw.Draw(loaded)
            draw.rectangle([3, 3, CARD_W - 4, CARD_H - 4], outline=(167, 139, 250, 255), width=3)
            draw.text((24, CARD_H // 2 - 15), f"ID: {cid}", fill=(226, 232, 240, 255))
        card_images.append(loaded)

    n = max(1, len(card_images))
    canvas = Image.new("RGBA", ((CARD_W * n) + (GAP * (n + 1)), CARD_H + (GAP * 2)), BG_COLOR)
    x = GAP
    for im in card_images:
        canvas.paste(im, (x, GAP), im)
        x += CARD_W + GAP

    RENDERS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = RENDERS_DIR / out_filename
    canvas.save(out_path, format="PNG", optimize=True)
    return out_path


HITS_FILE = PROJECT_ROOT / "reports" / "gp_hits.jsonl"


def _record_hit(nickname: str, friend_id: str, xml_filename: str, tags: str, img_path: Path,
                card_ids: List[str], mode: str) -> None:
    """2026-11-09 (Ale): every God Pack (own or lent account) is also written here, so clicking
    "GOD PACK HITS" in the God Pack UI can list them: name, ID, XML, cards and collage. Monitor Pokemon
    uploads them so every host sees the God Packs of all hosts. mode: "godpack" = friend requests were
    sent to the Mains (usable, ✅); "packs-only" = no Mains added (not usable, ❌)."""
    try:
        HITS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with HITS_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps({
                "ts": int(time.time() * 1000), "name": nickname, "id": friend_id, "xml": xml_filename,
                "tags": tags, "image": str(img_path), "cards": list(card_ids or []), "mode": mode,
                "lent": os.environ.get("ZENITH_ACCOUNT_OWNER", "").strip().isdigit(),
            }, ensure_ascii=False) + "\n")
    except Exception:
        pass


def build_collage_for_hit(card_ids: List[str], name: str) -> Optional[Path]:
    """Collage for a God Pack found on another host (the God Pack UI builds it from the card IDs)."""
    out = RENDERS_DIR / name
    if out.is_file():
        return out
    try:
        return _build_pack_collage(card_ids, name)
    except Exception:
        return None


def record_god_pack_async(account: dict, card_ids: List[str], pack_label: str, packs_count: int,
                          pack_id: str, sess=None, mode: str = "packs-only",
                          log_fn: Optional[Callable[[str], None]] = None) -> None:
    """Only writes the God Pack to the list (no Discord post): used in Open Packs Only, where no Main
    was added, so the God Pack can't be used but still shows up (with ❌) in the God Pack UI."""
    nickname, user_16_id, xml_filename = _resolve_clean_metadata(account, sess=sess)
    tier_1_to_5 = _normalize_pack_tier(pack_label, card_ids)

    def _worker():
        try:
            tags = f"[{tier_1_to_5}][{packs_count}P][{PACK_TAG_MAP.get(pack_id, pack_id)}]"
            img = _build_pack_collage(card_ids, f"gp_{Path(xml_filename).stem}_{int(threading.get_ident())}.png")
            _record_hit(nickname, user_16_id, xml_filename, tags, img, card_ids, mode)
            if log_fn:
                log_fn("[gp-list] God Pack saved to the list (Open Packs Only: not posted, no Mains added)")
        except Exception as e:
            if log_fn:
                log_fn(f"[gp-list] error: {e}")

    threading.Thread(target=_worker, daemon=False).start()


def notify_god_pack_async(
    account: dict,
    card_ids: List[str],
    pack_label: str,
    packs_count: int,
    pack_id: str,
    sess=None,
    clean_dirty_tag: str = "",
    log_fn: Optional[Callable[[str], None]] = None,
) -> None:
    # Obtiene el Nickname real y el Friend ID de 16 dígitos directamente de MyProfileV1 antes de cerrar sesión
    nickname, user_16_id, xml_filename = _resolve_clean_metadata(account, sess=sess)
    tier_1_to_5 = _normalize_pack_tier(pack_label, card_ids)

    def _worker():
        try:
            pack_short = PACK_TAG_MAP.get(pack_id, pack_id)
            header_tags = f"[{tier_1_to_5}][{packs_count}P][{pack_short}]"
            if clean_dirty_tag:
                header_tags += f" {clean_dirty_tag.strip()}"

            render_name = f"gp_{Path(xml_filename).stem}_{int(threading.get_ident())}.png"
            img_path = _build_pack_collage(card_ids, render_name)
            _record_hit(nickname, user_16_id, xml_filename, header_tags, img_path, card_ids, "godpack")

            webhook, mencion = _config_discord()
            if not webhook:
                # 2026-11-06 (Arcade): antes se salia callado y el God Pack no se posteaba sin que nadie supiera.
                if log_fn:
                    log_fn("[discord] GOD PACK NOT POSTED: 'God Pack Hit Webhook URL' is empty in the God Pack UI "
                           "(Collectors / Discord tab) - fill it and press Save Settings")
                return
            # Formato que lee KyuremBot (gpmod.py de wr98): 1ra linea = <@dueño>, "Nickname (16 digitos)",
            # "[3/5][2P][Pack]" y "File name: x.xml" (sale en el pie de su post).
            msg = (f"<@{mencion}>\n" if mencion else "") + f"{nickname} ({user_16_id})\n{header_tags}\nFile name: {xml_filename}"
            # Cuenta prestada por un miembro (reroll de la comunidad, Monitor Pokemon pone su id):
            # se lo menciona para que sepa que el GP salio en SU cuenta.
            dueno = os.environ.get("ZENITH_ACCOUNT_OWNER", "").strip()
            if dueno.isdigit():
                msg = f"<@{dueno}> \U0001F381 God Pack on your lent account!\n" + msg

            payload_json = {"content": msg, "allowed_mentions": {"parse": ["users"]}}

            with open(img_path, "rb") as f:
                r = requests.post(
                    webhook,
                    files={
                        "payload_json": (None, json.dumps(payload_json), "application/json"),
                        "file": (img_path.name, f, "image/png"),
                    },
                    timeout=20,
                )
            if log_fn:
                if r.ok:
                    log_fn("[discord] God Pack posted")
                else:
                    log_fn(f"[discord] GOD PACK NOT POSTED: Discord answered HTTP {r.status_code} "
                           "(check the 'God Pack Hit Webhook URL')")
        except Exception as e:
            if log_fn:
                log_fn(f"[discord] error: {e}")

    # (2026-11-06) daemon=False: en el GP farm cada tanda es un inject.py que termina enseguida, y un hilo
    # daemon moria con el proceso antes de mandar el aviso (God Pack sin post en el grupo).
    threading.Thread(target=_worker, daemon=False).start()