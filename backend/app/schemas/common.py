from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer

T = TypeVar("T")


def _iso_z(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


UTCDateTime = Annotated[
    datetime,
    PlainSerializer(_iso_z, return_type=str, when_used="json"),
]


def utcnow() -> datetime:
    return datetime.now(UTC)


class Schema(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class Page(Schema, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


class ErrorDetail(Schema):
    field: str
    message: str


class ErrorBody(Schema):
    code: str = Field(examples=["invalid_credentials"])
    message: str
    details: Any = None


class ErrorResponse(Schema):
    error: ErrorBody


ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    code: {"model": ErrorResponse, "description": desc}
    for code, desc in {
        401: "Missing or invalid credentials",
        422: "Validation error (`validation_error`, details = field list)",
        429: "Rate limited (`rate_limited`, see `Retry-After`)",
    }.items()
}
