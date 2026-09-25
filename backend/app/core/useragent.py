"""Tiny user-agent classifier (device type, browser, bot/link-preview detection). No external deps."""

from __future__ import annotations

import re

_BOT_RE = re.compile(
    r"bot\b|bot/|crawler|spider|slurp|facebookexternalhit|facebookcatalog|meta-externalagent|whatsapp|"
    r"telegram|slack|discord|linkedin|skypeuripreview|embedly|preview|pinterest|vkshare|w3c_validator|"
    r"quora link|redditbot|applebot|bingpreview|google-inspectiontool|headlesschrome|python-requests|"
    r"curl/|wget/|go-http-client|okhttp|axios|node-fetch|httpx|python-urllib|libwww|scrapy|lighthouse",
    re.IGNORECASE,
)


def is_bot(ua: str | None) -> bool:
    if not ua:
        return True
    return bool(_BOT_RE.search(ua))


def device_type(ua: str | None) -> str:
    u = (ua or "").lower()
    if "iphone" in u or "ipad" in u or "ipod" in u:
        return "ios"
    if "android" in u:
        return "android"
    if any(k in u for k in ("windows nt", "macintosh", "x11", "cros", "linux x86_64")):
        return "desktop"
    return "other"


def browser(ua: str | None) -> str:
    u = (ua or "").lower()
    for needle, name in (
        ("samsungbrowser", "samsung"), ("edg/", "edge"), ("opr/", "opera"), ("firefox", "firefox"),
        ("fxios", "firefox"), ("crios", "chrome"), ("chrome", "chrome"), ("safari", "safari"),
    ):
        if needle in u:
            return name
    return "other"
