"""Application settings loaded from environment variables / `.env`."""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

PLACEHOLDER_JWT_SECRET = "change-this-to-a-long-random-production-secret"
PLACEHOLDER_WEBHOOK_SECRET = "change-this-secret"
PLACEHOLDER_ADMIN_PASSWORD = "ChangeThisImmediately"
MIN_PRODUCTION_SECRET_LENGTH = 32

VERSION = "1.0.0"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    # ── Application ──────────────────────────────────────────────
    APP_NAME: str = "nexTap"
    ENVIRONMENT: str = "development"
    DEBUG: bool = False
    API_BASE_URL: str = "http://127.0.0.1:8000"
    # URL phones use to reach this API (shown on the dashboard). Defaults to API_BASE_URL.
    DEVICE_SERVER_URL: str = ""

    # ── Database ─────────────────────────────────────────────────
    DATABASE_URL: str = (
        "postgresql+psycopg://postgres:YourStrongPassword@127.0.0.1:5432/nfc_platform"
    )
    DB_HOST: str = "127.0.0.1"
    DB_PORT: int = 5432
    DB_USER: str = "postgres"
    DB_PASSWORD: str = "YourStrongPassword"
    DB_NAME: str = "nfc_platform"

    # ── Redis ────────────────────────────────────────────────────
    REDIS_URL: str = "redis://127.0.0.1:6379/0"

    # ── Auth ─────────────────────────────────────────────────────
    JWT_SECRET: str = PLACEHOLDER_JWT_SECRET
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 10080

    # ── API keys ─────────────────────────────────────────────────
    API_KEY_PREFIX: str = "nfc_"
    API_KEY_LENGTH: int = 48

    # ── Rate limiting ────────────────────────────────────────────
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_REQUESTS: int = 100
    RATE_LIMIT_WINDOW_SECONDS: int = 60

    # ── Webhooks ─────────────────────────────────────────────────
    WEBHOOK_TIMEOUT_SECONDS: int = 10
    WEBHOOK_MAX_RETRIES: int = 3
    WEBHOOK_SIGNING_SECRET: str = PLACEHOLDER_WEBHOOK_SECRET

    # ── CORS ─────────────────────────────────────────────────────
    CORS_ORIGINS: Annotated[list[str], NoDecode] = [
        "http://localhost:3000",
        "http://localhost:5173",
    ]

    # ── Email ────────────────────────────────────────────────────
    EMAIL_ENABLED: bool = False
    EMAIL_SMTP_SERVER: str = "mail.example.com"
    EMAIL_SMTP_PORT: int = 587
    EMAIL_LOGIN: str = "info@example.com"
    EMAIL_SENDER_EMAIL: str = "info@example.com"
    EMAIL_SENDER_PASSWORD: str = ""
    EMAIL_SENDER_NAME: str = "nexTap"

    # ── Default admin ────────────────────────────────────────────
    DEFAULT_ADMIN_EMAIL: str = "admin@example.com"
    DEFAULT_ADMIN_PASSWORD: str = PLACEHOLDER_ADMIN_PASSWORD
    DEFAULT_ADMIN_NAME: str = "Platform Administrator"

    # ── Extras (optional; sensible defaults) ─────────────────────
    AUTH_RATE_LIMIT_REQUESTS: int = 10
    AUTH_RATE_LIMIT_WINDOW_SECONDS: int = 60
    # Run the retry worker inside the API process (disable when running
    # `python -m app.workers.delivery` as a separate process).
    DELIVERY_WORKER_ENABLED: bool = True
    DELIVERY_WORKER_POLL_SECONDS: float = 1.0
    # Trust X-Forwarded-For / X-Forwarded-Proto (only behind a trusted proxy).
    TRUST_PROXY_HEADERS: bool = False
    # Number of trusted proxies in front of the API: the client IP is the Nth entry from the RIGHT of
    # X-Forwarded-For (entries to the left of it are client-supplied and can be spoofed).
    TRUSTED_PROXY_HOPS: int = 1
    # Every request also counts against a per-IP bucket of RATE_LIMIT_REQUESTS × this factor (so rotating
    # made-up bearer tokens / sandbox paths can't escape per-IP limiting; generous for NATed offices).
    RATE_LIMIT_IP_MULTIPLIER: int = 5
    # Failed sign-ins per email address (any IP) within the window before 429.
    LOGIN_FAILURES_PER_EMAIL: int = 10
    LOGIN_FAILURE_WINDOW_SECONDS: int = 900
    # Reject plain-http requests + send HSTS. Defaults to true in production.
    ENFORCE_HTTPS: bool | None = None
    # Link placed in password reset emails (token appended as ?token=...).
    PASSWORD_RESET_URL: str = "http://localhost:5173/reset-password"
    PASSWORD_RESET_EXPIRE_MINUTES: int = 60
    LOG_LEVEL: str = "INFO"
    LOG_JSON: bool | None = None

    # ── Part 2 (business accounts, observability, sandbox) ───────
    # Base for /t/{code} and /sandbox/{token}; empty = DEVICE_SERVER_URL or API_BASE_URL.
    PUBLIC_API_URL: str = ""
    # Base for /b/{slug}, /invite/{token}, /docs/errors, /tap/unavailable.
    PUBLIC_WEB_URL: str = "http://localhost:5173"
    MEDIA_ROOT: str = "./media"
    # Built APKs: private (never under MEDIA_ROOT, which /media serves publicly); served only by /downloads/*.
    RELEASES_ROOT: str = "./releases"
    # Part 5: card design v2 templates (relative paths are resolved from the backend directory).
    CARD_TEMPLATES_V2_PATH: str = "app/data/card_templates_v2.json"
    MEDIA_MAX_UPLOAD_BYTES: int = 2 * 1024 * 1024
    SEED_DEMO_DATA: bool = False
    DEMO_PASSWORD: str = "DemoPassword123"
    REQUEST_LOG_ENABLED: bool = True
    # Point a developer's first application at their sandbox endpoint automatically.
    SANDBOX_AUTO_ATTACH: bool = True
    EMAIL_VERIFICATION_EXPIRE_HOURS: int = 48
    # Part 3: admin email campaigns are sent by the worker at most this many per minute.
    EMAIL_THROTTLE_PER_MINUTE: int = 120
    # Part 3 §6: Swagger/ReDoc/OpenAPI are off by default in every environment.
    API_DOCS_ENABLED: bool = False
    # Part 3 §9: mobile app builds (worker subprocess).
    APP_BUILD_ENABLED: bool = False
    FLUTTER_BIN: str = "flutter"
    MOBILE_PROJECT_DIR: str = ""
    JAVA_HOME: str = ""
    ANDROID_SDK_ROOT: str = ""
    APP_BUILD_TIMEOUT_SECONDS: int = 1800

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @field_validator("ENFORCE_HTTPS", "LOG_JSON", mode="before")
    @classmethod
    def _blank_is_none(cls, v: object) -> object:
        return None if isinstance(v, str) and v.strip() == "" else v

    @field_validator("ENVIRONMENT")
    @classmethod
    def _norm_env(cls, v: str) -> str:
        return v.strip().lower()

    @field_validator("API_KEY_LENGTH")
    @classmethod
    def _key_length(cls, v: int) -> int:
        if v < 32 or v > 128:
            raise ValueError("API_KEY_LENGTH must be between 32 and 128")
        return v

    @model_validator(mode="after")
    def _production_checks(self) -> "Settings":
        if self.is_production:
            problems: list[str] = []
            for name, placeholder in (
                ("JWT_SECRET", PLACEHOLDER_JWT_SECRET),
                ("WEBHOOK_SIGNING_SECRET", PLACEHOLDER_WEBHOOK_SECRET),
            ):
                value = getattr(self, name)
                if value == placeholder:
                    problems.append(f"{name} is the placeholder default")
                elif len(value) < MIN_PRODUCTION_SECRET_LENGTH:
                    problems.append(
                        f"{name} must be at least {MIN_PRODUCTION_SECRET_LENGTH} characters"
                    )
            if self.DEBUG:
                problems.append("DEBUG must be false in production")
            for name, url in (("PUBLIC_WEB_URL", self.PUBLIC_WEB_URL), ("PASSWORD_RESET_URL", self.PASSWORD_RESET_URL)):
                if _local_or_http(url):
                    problems.append(f"{name} must be a public https URL (got {url!r})")
            bad_origins = [o for o in self.CORS_ORIGINS if _local_or_http(o)]
            if bad_origins:
                problems.append("CORS_ORIGINS must only contain public https origins (got "
                                + ", ".join(bad_origins) + ")")
            if problems:
                raise ValueError(
                    "Refusing to start in production: " + "; ".join(problems)
                )
        return self

    # ── Derived ──────────────────────────────────────────────────
    @property
    def is_production(self) -> bool:
        # Anything that isn't explicitly "development" (staging, prod, typos…) gets the production safeguards.
        return self.ENVIRONMENT != "development"

    @property
    def is_development(self) -> bool:
        return self.ENVIRONMENT == "development"

    @property
    def enforce_https(self) -> bool:
        if self.ENFORCE_HTTPS is None:
            return self.is_production
        return self.ENFORCE_HTTPS

    @property
    def log_json(self) -> bool:
        if self.LOG_JSON is None:
            return not self.is_development
        return self.LOG_JSON

    @property
    def public_api_url(self) -> str:
        return (self.PUBLIC_API_URL or self.DEVICE_SERVER_URL or self.API_BASE_URL).rstrip("/")

    @property
    def public_web_url(self) -> str:
        return self.PUBLIC_WEB_URL.rstrip("/")

    @property
    def device_token_prefix(self) -> str:
        return "nfcd_"


def _local_or_http(url: str) -> bool:
    """True for plain-http URLs and loopback/unspecified hosts (not usable by real users in production)."""
    from urllib.parse import urlsplit

    try:
        parts = urlsplit((url or "").strip())
    except ValueError:
        return True
    host = (parts.hostname or "").lower()
    return parts.scheme != "https" or not host or host in ("localhost", "127.0.0.1", "0.0.0.0", "::1") \
        or host.endswith(".localhost")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

# Retry schedule (seconds) after failed attempt n (1-based). Capped at last value.
RETRY_BACKOFF_SECONDS: list[int] = [10, 60, 300, 900, 1800, 3600]
