"""Endpoint URL validation and SSRF protection (contract section 5)."""

from __future__ import annotations

import asyncio
import re
import ipaddress
import socket
from urllib.parse import urlsplit

from app.core.config import settings

MAX_URL_LENGTH = 2048
DEV_HTTP_HOSTS = {"localhost", "127.0.0.1", "10.0.2.2", "::1"}
METADATA_IPS = {
    ipaddress.ip_address("169.254.169.254"),
    ipaddress.ip_address("fd00:ec2::254"),
    ipaddress.ip_address("100.100.100.200"),  # Alibaba Cloud metadata
}
EXTRA_BLOCKED_NETS = [
    ipaddress.ip_network("100.64.0.0/10"),  # carrier-grade NAT
    ipaddress.ip_network("192.0.0.0/24"),
    ipaddress.ip_network("198.18.0.0/15"),  # benchmarking
]
BLOCKED_HOSTNAMES = {"localhost", "metadata.google.internal", "metadata"}


class InvalidEndpointURL(ValueError):
    pass


def _parse_ip(host: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    try:
        return ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        return None


def is_blocked_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return (
        ip in METADATA_IPS
        or ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
        or any(ip in net for net in EXTRA_BLOCKED_NETS)
    )


def _is_private_lan_host(host: str) -> bool:
    ip = _parse_ip(host)
    if ip is None:
        return host.endswith(".local") or host.endswith(".lan")
    return ip.is_private or ip.is_loopback


def validate_endpoint_url_syntax(url: str) -> str:
    """Static checks. Returns the normalised URL or raises InvalidEndpointURL."""
    url = (url or "").strip()
    if not url:
        raise InvalidEndpointURL("URL must not be empty")
    if len(url) > MAX_URL_LENGTH:
        raise InvalidEndpointURL(f"URL must be at most {MAX_URL_LENGTH} characters")
    if any(c in url for c in ("\r", "\n", "\t", " ")):
        raise InvalidEndpointURL("URL must not contain whitespace")
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError as exc:
        raise InvalidEndpointURL("URL is malformed") from exc
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https"):
        raise InvalidEndpointURL("URL scheme must be https")
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        raise InvalidEndpointURL("URL must not contain credentials")
    if parts.fragment or url.endswith("#"):
        raise InvalidEndpointURL("URL must not contain a fragment")
    host = (parts.hostname or "").lower()
    if not host:
        raise InvalidEndpointURL("URL must include a host")
    if port is not None and not (1 <= port <= 65535):
        raise InvalidEndpointURL("URL port is invalid")

    if settings.is_development:
        if scheme == "http" and not (host in DEV_HTTP_HOSTS or _is_private_lan_host(host)):
            raise InvalidEndpointURL(
                "URL must use https (http is only allowed for localhost / private LAN in development)"
            )
        return url

    if scheme != "https":
        raise InvalidEndpointURL("URL must use https")
    if host in BLOCKED_HOSTNAMES or host.endswith(".localhost") or host.endswith(".internal"):
        raise InvalidEndpointURL("URL host is not allowed")
    ip = _parse_ip(host)
    if ip is not None and is_blocked_ip(ip):
        raise InvalidEndpointURL("URL resolves to a private or reserved address")
    return url


async def _resolve(host: str, port: int) -> list[str]:
    loop = asyncio.get_running_loop()
    infos = await asyncio.wait_for(
        loop.getaddrinfo(host, port, type=socket.SOCK_STREAM), timeout=5
    )
    return [info[4][0] for info in infos]


async def validate_endpoint_url(url: str, *, resolve: bool | None = None) -> str:
    """Full validation. In non-development environments also resolves DNS and
    rejects hosts that resolve to private/loopback/link-local/metadata IPs."""
    return (await resolve_endpoint_url(url, resolve=resolve))[0]


async def resolve_endpoint_url(url: str, *, resolve: bool | None = None) -> tuple[str, str | None]:
    """Like `validate_endpoint_url`, also returning the vetted IP (None when not resolved / an IP literal).
    Senders connect to exactly that IP so a DNS answer can't change between the check and the connection
    (DNS rebinding)."""
    url = validate_endpoint_url_syntax(url)
    if resolve is None:
        resolve = not settings.is_development
    if not resolve:
        return url, None
    parts = urlsplit(url)
    host = parts.hostname or ""
    if _parse_ip(host) is not None:
        return url, None  # literal IPs already checked
    try:
        addresses = await _resolve(host, parts.port or 443)
    except (OSError, TimeoutError, asyncio.TimeoutError) as exc:
        raise InvalidEndpointURL("URL host could not be resolved") from exc
    if not addresses:
        raise InvalidEndpointURL("URL host could not be resolved")
    for addr in addresses:
        ip = _parse_ip(addr.split("%")[0])
        if ip is None or is_blocked_ip(ip):
            raise InvalidEndpointURL("URL resolves to a private or reserved address")
    return url, addresses[0].split("%")[0]


def pin_url(url: str, ip: str) -> tuple[str, dict[str, str], dict[str, str]]:
    """(url with the host replaced by `ip`, Host header, httpx extensions) — TLS still verifies the certificate
    against the original hostname through SNI."""
    parts = urlsplit(url)
    host = parts.hostname or ""
    literal = f"[{ip}]" if ":" in ip else ip
    netloc = literal + (f":{parts.port}" if parts.port else "")
    pinned = parts._replace(netloc=netloc).geturl()
    host_header = host + (f":{parts.port}" if parts.port else "")
    return pinned, {"Host": host_header}, ({"sni_hostname": host} if parts.scheme == "https" else {})


_SCHEME_RE = re.compile(r"^([a-z][a-z0-9+.\-]*):")
SAFE_LINK_SCHEMES = {"http", "https", "mailto", "tel"}


def unsafe_url_scheme(value: str) -> bool:
    """True for user-supplied links with a non-web scheme (javascript:, data:, vbscript:, file: …). Browsers ignore
    control characters/whitespace inside a scheme, so they are stripped before checking."""
    cleaned = "".join(ch for ch in value if ch.isprintable() and not ch.isspace()).lower()
    match = _SCHEME_RE.match(cleaned)
    return bool(match) and match.group(1) not in SAFE_LINK_SCHEMES


# ── Endpoint domain allowlist (contract 7.1) ────────────────────────────
MAX_ALLOWED_DOMAINS = 20
_LABEL_RE = re.compile(r"^(?!-)[a-z0-9-]{1,63}(?<!-)$")


def normalize_domain_entry(entry: str) -> str:
    """Validates one allowlist entry: `host.example.com`, `*.example.com` or an IP literal."""
    value = (entry or "").strip().lower().rstrip(".")
    if not value:
        raise ValueError("domain must not be empty")
    if len(value) > 253:
        raise ValueError(f"{entry!r} is too long")
    if _parse_ip(value) is not None:
        return str(_parse_ip(value))
    host = value[2:] if value.startswith("*.") else value
    if "*" in host:
        raise ValueError(f"{entry!r}: a wildcard is only allowed as the leading '*.' label")
    labels = host.split(".")
    if any(not _LABEL_RE.match(label) for label in labels):
        raise ValueError(f"{entry!r} is not a valid hostname (no scheme, port or path)")
    if value.startswith("*.") and len(labels) < 2:
        raise ValueError(f"{entry!r}: wildcard needs at least two labels (e.g. *.example.com)")
    return value


def normalize_domain_list(entries: list[str]) -> list[str]:
    out: list[str] = []
    for entry in entries:
        value = normalize_domain_entry(entry)
        if value not in out:
            out.append(value)
    if len(out) > MAX_ALLOWED_DOMAINS:
        raise ValueError(f"at most {MAX_ALLOWED_DOMAINS} domains are allowed")
    return out


def host_matches_allowlist(host: str, allowed: list[str] | None) -> bool:
    """Empty allowlist = unrestricted. `*.x.com` matches sub-domains only, not the apex."""
    if not allowed:
        return True
    host = (host or "").strip().lower().rstrip(".").strip("[]")
    ip = _parse_ip(host)
    if ip is not None:
        host = str(ip)
    for entry in allowed:
        if entry.startswith("*."):
            if host.endswith(entry[1:]) and host != entry[2:]:
                return True
        elif host == entry:
            return True
    return False


def url_matches_allowlist(url: str | None, allowed: list[str] | None) -> bool:
    if not allowed:
        return True
    if not url:
        return True
    try:
        host = urlsplit(url).hostname or ""
    except ValueError:
        return False
    return host_matches_allowlist(host, allowed)
