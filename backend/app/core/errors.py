"""Consistent error envelope: `{"error": {"code", "message", "details"}}`."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.error_catalog import CATALOG, FALLBACK

logger = logging.getLogger("app.errors")


class AppError(Exception):
    """Raise anywhere to return a structured error response."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: Any = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details
        self.headers = headers


def not_found(resource: str = "Resource") -> AppError:
    return AppError(404, "not_found", f"{resource} not found")


def validation_error(field: str, message: str) -> AppError:
    return AppError(
        422,
        "validation_error",
        "Request validation failed",
        [{"field": field, "message": message}],
    )


def plan_limit(message: str) -> AppError:
    return AppError(402, "plan_limit_reached", message)


def error_body(code: str, message: str, details: Any = None, request_id: str | None = None) -> dict[str, Any]:
    from app.core.config import settings
    from app.core.logging import request_id_ctx

    entry = CATALOG.get(code, FALLBACK)
    rid = request_id or request_id_ctx.get()
    return {
        "error": {
            "code": code,
            "message": message,
            "details": details,
            "ref": entry.ref,
            "request_id": rid,
            "docs_url": f"{settings.public_web_url}/docs/errors#{entry.ref}",
        }
    }


def mark_error(request: Request | None, code: str) -> None:
    """Remember the error on the request so the request log can record it."""
    if request is not None:
        try:
            request.state.error_code = code
        except Exception:  # pragma: no cover
            pass


def error_response(
    status_code: int,
    code: str,
    message: str,
    details: Any = None,
    headers: dict[str, str] | None = None,
    request: Request | None = None,
) -> JSONResponse:
    mark_error(request, code)
    rid = getattr(request.state, "request_id", None) if request is not None else None
    return JSONResponse(
        status_code=status_code,
        content=error_body(code, message, details, rid),
        headers=headers,
    )


_STATUS_CODES: dict[int, str] = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    415: "unsupported_media_type",
    422: "validation_error",
    429: "rate_limited",
    500: "internal_error",
    503: "service_unavailable",
}


def _field_from_loc(loc: tuple[Any, ...] | list[Any]) -> str:
    return ".".join(str(p) for p in loc)


def _clean_msg(msg: str) -> str:
    # pydantic prefixes custom ValueErrors with "Value error, "
    return msg.removeprefix("Value error, ")


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError) -> JSONResponse:
        return error_response(
            exc.status_code, exc.code, exc.message, exc.details, exc.headers, request
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        details = [
            {"field": _field_from_loc(e.get("loc", ())), "message": _clean_msg(e.get("msg", ""))}
            for e in exc.errors()
        ]
        return error_response(422, "validation_error", "Request validation failed", details, None, request)

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _STATUS_CODES.get(exc.status_code, "error")
        message = exc.detail if isinstance(exc.detail, str) else code.replace("_", " ")
        if exc.status_code == 404 and message == "Not Found":
            message = "The requested resource was not found"
        if exc.status_code == 405:
            message = "Method not allowed"
        return error_response(
            exc.status_code, code, message, None, getattr(exc, "headers", None), request
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        logger.exception(
            "Unhandled error on %s %s", request.method, request.url.path, exc_info=exc
        )
        return error_response(500, "internal_error", "An unexpected error occurred", None, None, request)
