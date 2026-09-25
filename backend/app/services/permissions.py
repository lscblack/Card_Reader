"""Business roles & permissions (Part 2 §B1) — the single place where the matrix lives."""

from __future__ import annotations

ROLES = ("owner", "admin", "manager", "staff")

ALL_PERMISSIONS = (
    "business.view",
    "cards.manage",
    "people.manage",
    "profiles.manage",
    "devices.manage",
    "analytics.view",
    "api.view",
    "api.manage",
    "team.manage",
    "settings.manage",
    "billing.manage",
    "business.delete",
    "ownership.transfer",
)

OWNER_ONLY = frozenset({"billing.manage", "business.delete", "ownership.transfer"})
# Permissions that may be granted individually via `extra_permissions`.
GRANTABLE = tuple(p for p in ALL_PERMISSIONS if p not in OWNER_ONLY)

_MANAGER = {
    "business.view", "cards.manage", "people.manage", "profiles.manage", "devices.manage", "analytics.view",
}
_ADMIN = _MANAGER | {"api.view", "api.manage", "team.manage", "settings.manage"}

ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    "owner": frozenset(ALL_PERMISSIONS),
    "admin": frozenset(_ADMIN),
    "manager": frozenset(_MANAGER),
    "staff": frozenset({"business.view"}),
}

ROLE_RANK = {"staff": 0, "manager": 1, "admin": 2, "owner": 3}


def permissions_for(role: str, extra: list[str] | None = None) -> set[str]:
    perms = set(ROLE_PERMISSIONS.get(role, frozenset()))
    for p in extra or []:
        if p in GRANTABLE:
            perms.add(p)
    # api.manage implies api.view
    if "api.manage" in perms:
        perms.add("api.view")
    return perms


def ordered(perms: set[str]) -> list[str]:
    return [p for p in ALL_PERMISSIONS if p in perms]
