"""Allowlist SVG sanitiser (Part 3 §1): parses with defusedxml (no entities/XXE) and rebuilds the document
from allowed elements/attributes only. Scripts, event handlers, foreignObject, <style>, external references,
javascript:/data: URLs (except raster data URIs on <image>) are all dropped."""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET

from defusedxml import ElementTree as SafeET
from defusedxml.common import DefusedXmlException

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"

ALLOWED_ELEMENTS = {
    "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "defs",
    "lineargradient", "radialgradient", "stop", "clippath", "mask", "use", "symbol", "title", "desc", "image",
    "pattern", "filter", "fegaussianblur", "feoffset", "feblend", "fecolormatrix", "feflood", "fecomposite",
    "femerge", "femergenode",
}
ALLOWED_ATTRS = {
    "id", "class", "viewbox", "width", "height", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry",
    "d", "points", "fill", "fill-opacity", "fill-rule", "clip-rule", "stroke", "stroke-width", "stroke-opacity",
    "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "opacity",
    "transform", "offset", "stop-color", "stop-opacity", "gradientunits", "gradienttransform", "spreadmethod",
    "fx", "fy", "fr", "clip-path", "mask", "clippathunits", "maskunits", "maskcontentunits", "patternunits",
    "patterntransform", "preserveaspectratio", "font-family", "font-size", "font-weight", "font-style",
    "text-anchor", "dominant-baseline", "letter-spacing", "href", "version", "xmlns", "style", "filter",
    "stddeviation", "dx", "dy", "in", "in2", "result", "mode", "values", "type", "operator", "flood-color",
    "flood-opacity", "color", "visibility", "display", "vector-effect", "shape-rendering", "paint-order",
}
URL_ATTRS = {"fill", "stroke", "clip-path", "mask", "filter"}
_LOCAL_URL = re.compile(r"^\s*url\(\s*#[A-Za-z0-9_.:-]+\s*\)\s*$")
_RASTER_DATA = re.compile(r"^data:image/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$", re.I)
_STYLE_BAD = re.compile(r"url\s*\(|expression|javascript:|@import|behavior|-moz-binding", re.I)
MAX_BYTES = 1024 * 1024


class InvalidSVG(ValueError):
    pass


def _local(name: str) -> str:
    return name.rsplit("}", 1)[-1].lower() if "}" in name else name.lower()


def _ns(name: str) -> str:
    return name[1:].split("}", 1)[0] if name.startswith("{") else ""


def _clean_attrs(tag: str, attrs: dict[str, str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw_name, value in attrs.items():
        ns, name = _ns(raw_name), _local(raw_name)
        if ns not in ("", XLINK_NS, SVG_NS) or name.startswith("on") or name not in ALLOWED_ATTRS:
            continue
        v = value.strip()
        if name == "href":
            if tag == "image":
                if not _RASTER_DATA.match(v):
                    continue
            elif not v.startswith("#"):
                continue  # external references are dropped
            out["href"] = v
            continue
        if name in URL_ATTRS and "url(" in v.lower() and not _LOCAL_URL.match(v):
            continue
        if name == "style" and _STYLE_BAD.search(v):
            continue
        if re.search(r"javascript:|vbscript:|data:", v, re.I):
            continue
        out[name if name != "viewbox" else "viewBox"] = v
    return out


_CASE = {"lineargradient": "linearGradient", "radialgradient": "radialGradient", "clippath": "clipPath",
         "fegaussianblur": "feGaussianBlur", "feoffset": "feOffset", "feblend": "feBlend",
         "fecolormatrix": "feColorMatrix", "feflood": "feFlood", "fecomposite": "feComposite",
         "femerge": "feMerge", "femergenode": "feMergeNode"}
_ATTR_CASE = {"gradientunits": "gradientUnits", "gradienttransform": "gradientTransform",
              "spreadmethod": "spreadMethod", "clippathunits": "clipPathUnits", "maskunits": "maskUnits",
              "maskcontentunits": "maskContentUnits", "patternunits": "patternUnits",
              "patterntransform": "patternTransform", "preserveaspectratio": "preserveAspectRatio",
              "stddeviation": "stdDeviation"}


def _rebuild(src: ET.Element) -> ET.Element | None:
    tag = _local(src.tag)
    if _ns(src.tag) not in ("", SVG_NS) or tag not in ALLOWED_ELEMENTS:
        return None
    attrs = {(_ATTR_CASE.get(k, k)): v for k, v in _clean_attrs(tag, dict(src.attrib)).items()}
    el = ET.Element(_CASE.get(tag, tag), attrs)
    if tag in ("text", "tspan", "title", "desc"):
        el.text = src.text
    for child in src:
        rebuilt = _rebuild(child)
        if rebuilt is not None:
            if tag in ("text", "tspan"):
                rebuilt.tail = child.tail
            el.append(rebuilt)
    return el


def sanitize_svg(data: bytes) -> bytes:
    if len(data) > MAX_BYTES:
        raise InvalidSVG("SVG larger than 1 MB")
    if re.search(rb"<!DOCTYPE|<!ENTITY", data, re.I):
        raise InvalidSVG("DOCTYPE/ENTITY declarations are not allowed")
    try:
        root = SafeET.fromstring(data, forbid_dtd=True, forbid_entities=True, forbid_external=True)
    except (ET.ParseError, DefusedXmlException, ValueError) as exc:
        raise InvalidSVG("not a well-formed SVG document") from exc
    if _local(root.tag) != "svg":
        raise InvalidSVG("root element must be <svg>")
    clean = _rebuild(root)
    assert clean is not None
    clean.set("xmlns", SVG_NS)
    return b'<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(clean, encoding="utf-8", short_empty_elements=True) \
        .split(b"?>", 1)[-1].lstrip()


def looks_like_svg(data: bytes) -> bool:
    head = data[:512].lstrip().lower()
    return head.startswith(b"<?xml") or head.startswith(b"<svg") or b"<svg" in head
