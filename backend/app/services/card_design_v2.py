"""Part 5: card design v2 — template validation/loading, arrangements, design presets.

Templates are data (`app/data/card_templates_v2.json`), rendered generically by web + mobile, so everything in them is
validated strictly before it reaches a client: SVG paths may only contain the absolute commands `M L H V C S Q T A Z`
and plain numbers (no quotes, letters or markup can smuggle attributes into an SVG), coordinates stay near the canvas,
colours are tokens or `#RRGGBB`. An invalid template is skipped with a logged error — never a startup crash.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.core.errors import AppError

logger = logging.getLogger("app.card_templates")

FORMATS: dict[str, tuple[int, int]] = {"landscape": (1750, 1000), "portrait": (1000, 1586)}
SIDES = ("front", "back")
CATEGORIES = ("business", "badge", "minimal")
BLOCKS = ("photo", "name", "logo", "company", "tagline", "qr", "contacts", "socials", "website", "address", "bio",
          "badge_meta", "barcode")
COLOR_TOKENS = ("primary", "secondary", "background", "text", "accent")
FILL_TOKENS = (*COLOR_TOKENS, "image")
ALIGN = ("start", "center", "end")
PHOTO_SHAPES = ("circle", "rounded", "square", "hexagon")
ICON_STYLES = ("filled", "outline", "none")
HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
ID_RE = re.compile(r"^[a-z0-9_]{2,32}$")
ZONE_ID_RE = re.compile(r"^[a-z0-9_]{1,24}$")

# ── SVG path grammar ─────────────────────────────────────────────────────────
PATH_ARITY = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "T": 2, "A": 7, "Z": 0}
_PATH_CHARS = re.compile(r"^[MLHVCSQTAZ0-9.,\s-]*$")
_PATH_TOKEN = re.compile(r"[MLHVCSQTAZ]|-?(?:\d+(?:\.\d+)?|\.\d+)|[\s,]+")
MAX_PATH_LEN = 4000
MAX_LAYERS = 24
MAX_VARIANTS = 6
MAX_ZONES = 12


def validate_path(path: Any, width: int, height: int) -> str | None:
    """Returns an error message, or None when `path` is a safe absolute SVG path within the canvas (± 1 canvas)."""
    if not isinstance(path, str) or not path.strip():
        return "path must be a non-empty string"
    if len(path) > MAX_PATH_LEN:
        return f"path longer than {MAX_PATH_LEN} characters"
    if not _PATH_CHARS.match(path):
        return "path may only contain the commands M L H V C S Q T A Z, numbers, spaces and commas"
    tokens: list[str] = []
    pos = 0
    for m in _PATH_TOKEN.finditer(path):
        if m.start() != pos:
            return f"unexpected character at {pos}"
        pos = m.end()
        if not m.group().strip(" \t\r\n,"):
            continue
        tokens.append(m.group())
    if pos != len(path):
        return f"unexpected character at {pos}"
    if not tokens or tokens[0] != "M":
        return "path must start with M"
    cmd, args = None, []

    def flush() -> str | None:
        arity = PATH_ARITY[cmd]  # type: ignore[index]
        if arity == 0:
            return None if not args else "Z takes no numbers"
        if not args or len(args) % arity:
            return f"{cmd} needs a multiple of {arity} numbers"
        for i, value in enumerate(args):
            k = i % arity
            if cmd == "A" and k in (3, 4) and value not in (0.0, 1.0):
                return "arc flags must be 0 or 1"
            if cmd == "A" and k in (0, 1, 2):
                if abs(value) > 4 * max(width, height):
                    return "arc radius/rotation out of range"
                continue
            if cmd == "A":
                is_x = k == 5
            else:
                is_x = cmd == "H" or (cmd != "V" and k % 2 == 0)
            limit = width if is_x else height
            if not -limit <= value <= 2 * limit:
                return f"coordinate {value:g} is outside the canvas"
        return None

    for tok in tokens:
        if tok in PATH_ARITY:
            if cmd is not None and (err := flush()):
                return err
            cmd, args = tok, []
        else:
            args.append(float(tok))
    return flush() if cmd is not None else "empty path"


def _color(value: Any, allowed: tuple[str, ...]) -> bool:
    return isinstance(value, str) and (value in allowed or bool(HEX_RE.match(value)))


def _num(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def validate_design_values(design: Any, where: str = "default_design") -> list[str]:
    from app.services.personal import FONTS

    errors: list[str] = []
    if not isinstance(design, dict):
        return [f"{where} must be an object"]
    for key, value in design.items():
        if key in ("primary", "secondary", "background", "text", "accent"):
            if not (isinstance(value, str) and HEX_RE.match(value)):
                errors.append(f"{where}.{key} must be #RRGGBB")
        elif key == "font":
            if value not in FONTS:
                errors.append(f"{where}.font must be one of {', '.join(FONTS)}")
        elif key == "photo_shape":
            if value not in PHOTO_SHAPES:
                errors.append(f"{where}.photo_shape invalid")
        elif key == "photo_ring":
            if not isinstance(value, bool):
                errors.append(f"{where}.photo_ring must be a boolean")
        elif key == "icon_style":
            if value not in ICON_STYLES:
                errors.append(f"{where}.icon_style invalid")
        elif key == "decor_style":
            if value is not None and not (isinstance(value, str) and ZONE_ID_RE.match(value)):
                errors.append(f"{where}.decor_style must be a short id or null")
        elif key == "background_image_opacity":
            if not (_num(value) and 0 <= value <= 0.8):
                errors.append(f"{where}.background_image_opacity must be 0-0.8")
        elif key in ("background_style", "pattern", "corner_radius", "show_qr"):
            continue  # v1 keys are harmless (validated by the v1 validator when edited)
        else:
            errors.append(f"{where}.{key} is not a design property")
    return errors


def _layer_errors(layers: Any, where: str, width: int, height: int) -> list[str]:
    errors: list[str] = []
    if not isinstance(layers, list) or len(layers) > MAX_LAYERS:
        return [f"{where}.layers must be a list of at most {MAX_LAYERS}"]
    for i, layer in enumerate(layers):
        lw = f"{where}.layers.{i}"
        if not isinstance(layer, dict) or set(layer) - {"path", "fill", "opacity"}:
            errors.append(f"{lw} must be {{path, fill, opacity}}")
            continue
        if err := validate_path(layer.get("path"), width, height):
            errors.append(f"{lw}.path: {err}")
        if not _color(layer.get("fill"), FILL_TOKENS):
            errors.append(f"{lw}.fill must be a colour token, image or #RRGGBB")
        opacity = layer.get("opacity", 1)
        if not (_num(opacity) and 0 <= opacity <= 1):
            errors.append(f"{lw}.opacity must be 0-1")
    return errors


def validate_template(raw: Any) -> tuple[dict[str, Any] | None, list[str]]:
    """Returns (normalised template, []) or (None, errors)."""
    errors: list[str] = []
    if not isinstance(raw, dict):
        return None, ["template must be an object"]
    tid = raw.get("id")
    if not (isinstance(tid, str) and ID_RE.match(tid)):
        errors.append("id must be 2-32 chars of a-z, 0-9, _")
    if raw.get("engine") != "v2":
        errors.append('engine must be "v2"')
    name = raw.get("name")
    if not (isinstance(name, str) and 1 <= len(name) <= 60):
        errors.append("name must be 1-60 characters")
    description = raw.get("description", "")
    if not (isinstance(description, str) and len(description) <= 300):
        errors.append("description must be at most 300 characters")
    if raw.get("category") not in CATEGORIES:
        errors.append(f"category must be one of {', '.join(CATEGORIES)}")
    if not isinstance(raw.get("premium", False), bool):
        errors.append("premium must be a boolean")
    fmt = raw.get("format")
    if fmt not in FORMATS:
        errors.append("format must be landscape or portrait")
        return None, errors
    width, height = FORMATS[fmt]
    sides = raw.get("sides")
    if sides not in (["front"], ["front", "back"]):
        errors.append('sides must be ["front"] or ["front","back"]')
        return None, errors
    errors += validate_design_values(raw.get("default_design"))
    canvas = raw.get("canvas")
    if not isinstance(canvas, dict) or set(canvas) != set(sides):
        errors.append("canvas must have exactly one entry per side")
        return None, errors
    for side in sides:
        spec = canvas[side]
        where = f"canvas.{side}"
        if not isinstance(spec, dict) or set(spec) - {"background", "layers", "zones"}:
            errors.append(f"{where} must be {{background, layers, zones}}")
            continue
        if not _color(spec.get("background"), COLOR_TOKENS):
            errors.append(f"{where}.background must be a colour token or #RRGGBB")
        errors += _layer_errors(spec.get("layers", []), where, width, height)
        zones = spec.get("zones")
        if not isinstance(zones, list) or not 1 <= len(zones) <= MAX_ZONES:
            errors.append(f"{where}.zones must be a list of 1-{MAX_ZONES} zones")
            continue
        seen: set[str] = set()
        for i, zone in enumerate(zones):
            zw = f"{where}.zones.{i}"
            if not isinstance(zone, dict) or set(zone) - {"id", "rect", "align", "valign", "on", "accepts", "max_blocks"}:
                errors.append(f"{zw} has unknown keys")
                continue
            zid = zone.get("id")
            if not (isinstance(zid, str) and ZONE_ID_RE.match(zid)) or zid in seen:
                errors.append(f"{zw}.id must be a unique short id")
            else:
                seen.add(zid)
            rect = zone.get("rect")
            if not (isinstance(rect, list) and len(rect) == 4 and all(_num(v) for v in rect)):
                errors.append(f"{zw}.rect must be [x, y, w, h]")
            else:
                x, y, w, h = rect
                if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > width or y + h > height:
                    errors.append(f"{zw}.rect must lie inside the {width}×{height} canvas")
            if zone.get("align", "start") not in ALIGN or zone.get("valign", "start") not in ALIGN:
                errors.append(f"{zw}.align/valign must be start, center or end")
            if not _color(zone.get("on", "background"), COLOR_TOKENS):
                errors.append(f"{zw}.on must be a colour token or #RRGGBB")
            accepts = zone.get("accepts")
            if not (isinstance(accepts, list) and accepts and all(b in BLOCKS for b in accepts)
                    and len(set(accepts)) == len(accepts)):
                errors.append(f"{zw}.accepts must be a non-empty list of blocks ({', '.join(BLOCKS)})")
            mb = zone.get("max_blocks")
            if not (isinstance(mb, int) and not isinstance(mb, bool) and 1 <= mb <= len(BLOCKS)):
                errors.append(f"{zw}.max_blocks must be an integer 1-{len(BLOCKS)}")
    variants = raw.get("variants", [])
    if not isinstance(variants, list) or len(variants) > MAX_VARIANTS:
        errors.append(f"variants must be a list of at most {MAX_VARIANTS}")
        variants = []
    vids: set[str] = set()
    for i, var in enumerate(variants):
        vw = f"variants.{i}"
        if not isinstance(var, dict) or set(var) - {"id", "name", "canvas"}:
            errors.append(f"{vw} must be {{id, name, canvas}}")
            continue
        vid = var.get("id")
        if not (isinstance(vid, str) and ZONE_ID_RE.match(vid)) or vid in vids:
            errors.append(f"{vw}.id must be a unique short id")
        else:
            vids.add(vid)
        if not (isinstance(var.get("name"), str) and 1 <= len(var["name"]) <= 40):
            errors.append(f"{vw}.name must be 1-40 characters")
        vcanvas = var.get("canvas")
        if not isinstance(vcanvas, dict) or not vcanvas or set(vcanvas) - set(sides):
            errors.append(f"{vw}.canvas must override one or more of the template's sides")
            continue
        for side, spec in vcanvas.items():
            if not isinstance(spec, dict) or set(spec) != {"layers"}:
                errors.append(f"{vw}.canvas.{side} may only replace layers")
                continue
            errors += _layer_errors(spec.get("layers"), f"{vw}.canvas.{side}", width, height)
    if errors:
        return None, errors
    template = {"id": tid, "engine": "v2", "name": name, "category": raw["category"], "description": description,
                "premium": bool(raw.get("premium", False)), "format": fmt, "sides": list(sides),
                "default_design": dict(raw.get("default_design") or {}), "canvas": canvas,
                "default_arrangement": raw.get("default_arrangement"),
                "variants": [{"id": v["id"], "name": v["name"], "canvas": v["canvas"]} for v in variants]}
    arr_errors = arrangement_errors(template, template["default_arrangement"], "default_arrangement")
    if arr_errors:
        return None, [f"{e['field']}: {e['message']}" for e in arr_errors]
    return template, []


def load_templates(path: str | Path | None = None) -> list[dict[str, Any]]:
    """Valid v2 templates from the JSON file (missing file → []). Invalid entries are logged and skipped."""
    file = Path(path or settings.CARD_TEMPLATES_V2_PATH)
    if not file.is_absolute():
        file = Path(__file__).resolve().parents[2] / file
    if not file.exists():
        return []
    try:
        data = json.loads(file.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        logger.error("Card templates v2 file %s is unreadable: %s", file, exc)
        return []
    items = data.get("templates") if isinstance(data, dict) else data
    if not isinstance(items, list):
        logger.error("Card templates v2 file %s must contain a list of templates", file)
        return []
    out, ids = [], set()
    for i, raw in enumerate(items):
        template, errors = validate_template(raw)
        if template is not None and (template["id"] in ids or template["id"] in _v1_ids()):
            errors, template = ["duplicate id (or clashes with a v1 template)"], None
        if template is None:
            label = raw.get("id") if isinstance(raw, dict) else f"#{i}"
            logger.error("Skipping invalid card template %s: %s", label, "; ".join(errors[:10]))
            continue
        ids.add(template["id"])
        out.append(template)
    return out


def _v1_ids() -> set[str]:
    from app.services.personal import TEMPLATES

    return {t["id"] for t in TEMPLATES}


def db_row(template: dict[str, Any], order: int) -> dict[str, Any]:
    """CardTemplate columns. `layout`/`supports` give Part 4 (v1) clients a sensible fallback."""
    accepted = {b for side in template["canvas"].values() for z in side["zones"] for b in z["accepts"]}
    return {
        "id": template["id"], "name": template["name"], "description": template["description"],
        "layout": "compact" if template["format"] == "landscape" else "centered",
        "default_design": template["default_design"],
        "supports": {"photo": "photo" in accepted, "cover": any(
            layer["fill"] == "image" for side in template["canvas"].values() for layer in side.get("layers", [])),
            "logo": "logo" in accepted},
        "premium": template["premium"], "sort_order": 100 + order, "engine": "v2", "category": template["category"],
        "spec": {k: template[k] for k in ("format", "sides", "canvas", "default_arrangement", "variants")},
    }


# ── Arrangements ─────────────────────────────────────────────────────────────
def spec_of(template: Any) -> dict[str, Any] | None:
    """The v2 spec of a CardTemplate row (or a template dict), None for v1 templates."""
    if isinstance(template, dict):
        return template if template.get("engine") == "v2" else None
    if getattr(template, "engine", "v1") != "v2" or not template.spec:
        return None
    return template.spec


def _zones(spec: dict[str, Any], side: str) -> list[dict[str, Any]]:
    return list((spec["canvas"].get(side) or {}).get("zones") or [])


def arrangement_errors(spec: dict[str, Any], arrangement: Any, prefix: str = "body.arrangement") -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []
    if not isinstance(arrangement, dict):
        return [{"field": prefix, "message": "must be an object {side: {zone: [blocks]}}"}]
    used: dict[str, str] = {}
    for side, zones in arrangement.items():
        if side not in spec["sides"]:
            errors.append({"field": f"{prefix}.{side}", "message": "this template has no such side"})
            continue
        if not isinstance(zones, dict):
            errors.append({"field": f"{prefix}.{side}", "message": "must be an object {zone: [blocks]}"})
            continue
        known = {z["id"]: z for z in _zones(spec, side)}
        for zid, blocks in zones.items():
            where = f"{prefix}.{side}.{zid}"
            zone = known.get(zid)
            if zone is None:
                errors.append({"field": where, "message": "unknown zone"})
                continue
            if not isinstance(blocks, list) or not all(isinstance(b, str) for b in blocks):
                errors.append({"field": where, "message": "must be a list of block ids"})
                continue
            if len(blocks) > zone["max_blocks"]:
                errors.append({"field": where, "message": f"at most {zone['max_blocks']} blocks"})
            for block in blocks:
                if block not in BLOCKS:
                    errors.append({"field": where, "message": f"unknown block {block!r}"})
                elif block not in zone["accepts"]:
                    errors.append({"field": where, "message": f"zone does not accept {block!r}"})
                elif block in used:
                    errors.append({"field": where, "message": f"block {block!r} is already placed in {used[block]}"})
                else:
                    used[block] = f"{side}.{zid}"
    return errors


def validate_arrangement(spec: dict[str, Any], arrangement: Any) -> dict[str, dict[str, list[str]]]:
    errors = arrangement_errors(spec, arrangement)
    if errors:
        raise AppError(422, "invalid_arrangement", "The arrangement doesn't fit this template", errors)
    return {side: {z: list(b) for z, b in zones.items()} for side, zones in arrangement.items()}


def default_arrangement(spec: dict[str, Any]) -> dict[str, dict[str, list[str]]]:
    return {side: {z: list(b) for z, b in zones.items()}
            for side, zones in (spec.get("default_arrangement") or {}).items()}


def remap_arrangement(old: dict[str, Any] | None, spec: dict[str, Any]) -> dict[str, dict[str, list[str]]]:
    """Best-effort move of an arrangement onto another template: each block goes to the first zone accepting it
    (same side first) that still has room; blocks with no home are left out (hidden). No old v2 arrangement →
    the template default."""
    if not old:
        return default_arrangement(spec)
    out: dict[str, dict[str, list[str]]] = {side: {} for side in spec["sides"]}
    placed: set[str] = set()
    for side in SIDES:
        for _zone, blocks in ((old or {}).get(side) or {}).items():
            for block in blocks if isinstance(blocks, list) else []:
                if block in placed or block not in BLOCKS:
                    continue
                order = [side] + [s for s in spec["sides"] if s != side]
                for target in order:
                    if target not in spec["sides"]:
                        continue
                    zone = next((z for z in _zones(spec, target) if block in z["accepts"]
                                 and len(out[target].get(z["id"], [])) < z["max_blocks"]), None)
                    if zone is not None:
                        out[target].setdefault(zone["id"], []).append(block)
                        placed.add(block)
                        break
    return {side: zones for side, zones in out.items() if zones}


def validate_sides(spec: dict[str, Any] | None, sides: Any) -> list[str]:
    allowed = spec["sides"] if spec else ["front"]
    if not (isinstance(sides, list) and sides and sides[0] == "front" and len(set(sides)) == len(sides)
            and all(s in allowed for s in sides)):
        from app.core.errors import validation_error

        raise validation_error("body.sides_enabled", f"front first, a subset of {allowed}")
    return list(sides)


# ── Design presets (§3) ──────────────────────────────────────────────────────
def _p(pid: str, name: str, primary: str, secondary: str, background: str, text: str, accent: str) -> dict[str, str]:
    return {"id": pid, "name": name, "primary": primary, "secondary": secondary, "background": background,
            "text": text, "accent": accent}


PALETTES = [
    _p("crimson_navy", "Crimson & Navy", "#C8102E", "#1F2937", "#FFFFFF", "#111827", "#C8102E"),
    _p("platform_red", "Platform Red", "#B91C1C", "#450A0A", "#FFFFFF", "#18181B", "#DC2626"),
    _p("gold_black", "Gold & Black", "#C9A227", "#111111", "#0B0B0B", "#F5F5F4", "#E0B94A"),
    _p("navy_gold", "Navy & Gold", "#1E3A5F", "#C9A227", "#FFFFFF", "#0F172A", "#C9A227"),
    _p("teal", "Teal", "#0F766E", "#134E4A", "#FFFFFF", "#0F172A", "#14B8A6"),
    _p("ocean", "Ocean", "#1D4ED8", "#0EA5E9", "#FFFFFF", "#0F172A", "#38BDF8"),
    _p("forest", "Forest", "#166534", "#14532D", "#F7FEE7", "#052E16", "#65A30D"),
    _p("sunset", "Sunset", "#EA580C", "#BE123C", "#FFF7ED", "#431407", "#F59E0B"),
    _p("mono", "Monochrome", "#111827", "#4B5563", "#FFFFFF", "#111827", "#6B7280"),
    _p("mono_dark", "Midnight", "#F4F4F5", "#3F3F46", "#09090B", "#FAFAFA", "#A1A1AA"),
    _p("pastel", "Pastel", "#F9A8D4", "#A5B4FC", "#FFFBFE", "#3B0764", "#86EFAC"),
    _p("charcoal_red", "Charcoal & Red", "#DC2626", "#27272A", "#18181B", "#FAFAFA", "#EF4444"),
    _p("royal_purple", "Royal Purple", "#6D28D9", "#312E81", "#FFFFFF", "#1E1B4B", "#A78BFA"),
    _p("coral", "Coral", "#F43F5E", "#FB923C", "#FFF1F2", "#4C0519", "#FDA4AF"),
    _p("slate_sky", "Slate & Sky", "#334155", "#0284C7", "#F8FAFC", "#0F172A", "#38BDF8"),
    _p("earth", "Earth", "#92400E", "#78350F", "#FEFCE8", "#292524", "#CA8A04"),
    _p("emerald_night", "Emerald Night", "#10B981", "#064E3B", "#022C22", "#ECFDF5", "#34D399"),
    _p("rose_gold", "Rose Gold", "#B76E79", "#6B4F4F", "#FFF8F6", "#3F2A2B", "#E8B4B8"),
]

FONT_PAIRS = [  # ids == DigitalCard design.font values understood by every renderer
    {"id": "sans", "name": "Inter", "heading": "sans", "body": "sans", "style": "Clean and modern"},
    {"id": "display", "name": "Grotesk + Inter", "heading": "display", "body": "sans", "style": "Bold, attention-grabbing"},
    {"id": "geometric", "name": "Geometric", "heading": "geometric", "body": "sans", "style": "Crisp and contemporary"},
    {"id": "elegant", "name": "Serif + Inter", "heading": "serif", "body": "sans", "style": "Classic, trustworthy"},
    {"id": "serif", "name": "Classic serif", "heading": "serif", "body": "serif", "style": "Editorial, elegant"},
    {"id": "humanist", "name": "Humanist", "heading": "humanist", "body": "humanist", "style": "Warm and approachable"},
    {"id": "condensed", "name": "Condensed + Inter", "heading": "condensed", "body": "sans", "style": "Compact and strong"},
    {"id": "mono", "name": "Mono + Inter", "heading": "mono", "body": "sans", "style": "Technical, precise"},
]
