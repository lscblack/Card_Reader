"""CORS middleware whose allowed origins = env CORS_ORIGINS ∪ admin-managed DB origins."""

from __future__ import annotations

from starlette.datastructures import Headers
from starlette.middleware.cors import CORSMiddleware
from starlette.types import Receive, Scope, Send

from app.services import origins


class DynamicCORSMiddleware(CORSMiddleware):
    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and "origin" in Headers(scope=scope):
            await origins.ensure_fresh()  # at most one DB read per 30 s per process
        await super().__call__(scope, receive, send)

    def is_allowed_origin(self, origin: str) -> bool:
        return super().is_allowed_origin(origin) or origins.is_db_allowed(origin)
