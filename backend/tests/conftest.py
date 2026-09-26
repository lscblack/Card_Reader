"""Test fixtures: real PostgreSQL test database (migrated with Alembic) + fakeredis."""

from __future__ import annotations

import os

# Must be set before any `app.*` import.
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://postgres:YourStrongPassword@127.0.0.1:5432/nfc_platform_test",
)
os.environ["ENVIRONMENT"] = "development"
os.environ["DEBUG"] = "false"
os.environ["DELIVERY_WORKER_ENABLED"] = "false"
os.environ["EMAIL_ENABLED"] = "false"
os.environ["RATE_LIMIT_ENABLED"] = "true"
os.environ["RATE_LIMIT_REQUESTS"] = "1000"
os.environ["AUTH_RATE_LIMIT_REQUESTS"] = "1000"
os.environ["DEFAULT_ADMIN_EMAIL"] = "admin@example.com"
os.environ["DEFAULT_ADMIN_PASSWORD"] = "AdminPassword123"
os.environ["LOG_JSON"] = "false"
os.environ["SEED_DEMO_DATA"] = "false"
os.environ["SANDBOX_AUTO_ATTACH"] = "false"  # Part 1 tests expect a first app without an endpoint
os.environ["REQUEST_LOG_ENABLED"] = "true"
os.environ["MEDIA_ROOT"] = os.environ.get("TEST_MEDIA_ROOT", "/tmp/nfc-platform-test-media")
os.environ["CARD_TEMPLATES_V2_PATH"] = os.path.join(os.path.dirname(__file__), "fixtures", "card_templates_v2.json")
os.environ["PAGE_TEMPLATES_PATH"] = os.path.join(os.path.dirname(__file__), "fixtures", "page_templates.json")
os.environ["RELEASES_ROOT"] = os.environ.get("TEST_RELEASES_ROOT", "/tmp/nfc-platform-test-releases")
os.environ["PUBLIC_API_URL"] = "http://testserver"
os.environ["PUBLIC_WEB_URL"] = "http://web.test"
os.environ["API_DOCS_ENABLED"] = "false"
os.environ["APP_BUILD_ENABLED"] = "false"

import uuid  # noqa: E402
from collections.abc import AsyncIterator  # noqa: E402
from pathlib import Path  # noqa: E402
from typing import Any  # noqa: E402

import fakeredis  # noqa: E402
import psycopg  # noqa: E402
import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.redis import set_redis  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.services.seed import seed  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parents[1]
TABLES = [
    "pairing_codes", "allowed_origins",
    "deliveries", "nfc_events", "usage_daily", "devices", "api_keys", "applications",
    "audit_logs", "password_reset_tokens", "subscriptions", "users", "plans",
]


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> None:
    """Recreate the schema from scratch using the real Alembic migrations."""
    sync_url = settings.DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")
    with psycopg.connect(sync_url, autocommit=True) as conn:
        conn.execute("DROP SCHEMA IF EXISTS public CASCADE")
        conn.execute("CREATE SCHEMA public")
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.attributes["skip_logging_config"] = True
    command.upgrade(cfg, "head")


@pytest.fixture(autouse=True)
async def clean_state() -> AsyncIterator[fakeredis.FakeAsyncRedis]:
    redis = fakeredis.FakeAsyncRedis(decode_responses=True)
    set_redis(redis)
    async with SessionLocal() as session:
        tables = (await session.execute(text(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'alembic_version'"
        ))).scalars().all()
        await session.execute(text(f"TRUNCATE {', '.join(tables)} CASCADE"))
        await session.commit()
        await seed(session)
    from app.services import origins

    origins.set_cache(set())
    from app.services import platform_settings, request_logs

    platform_settings.set_cache({})
    from app.services import branding

    branding.set_cache({})
    request_logs._local.clear()
    yield redis
    await redis.flushall()


@pytest.fixture
def redis(clean_state: fakeredis.FakeAsyncRedis) -> fakeredis.FakeAsyncRedis:
    return clean_state


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c


# ── Helpers ──────────────────────────────────────────────────────────────
async def register(client: AsyncClient, email: str | None = None, password: str = "Sup3rSecretPass") -> dict[str, Any]:
    email = email or f"dev-{uuid.uuid4().hex[:8]}@example.com"
    r = await client.post("/api/v1/auth/register", json={"email": email, "password": password, "full_name": "Dev"})
    assert r.status_code == 201, r.text
    return r.json()


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def user(client: AsyncClient) -> dict[str, Any]:
    data = await register(client)
    data["headers"] = bearer(data["access_token"])
    return data


async def create_app(client: AsyncClient, headers: dict[str, str], **body: Any) -> dict[str, Any]:
    body.setdefault("name", "Front desk")
    r = await client.post("/api/v1/applications", json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


async def register_device(client: AsyncClient, api_key: str, installation_id: str | None = None) -> dict[str, Any]:
    r = await client.post(
        "/api/v1/device/register",
        json={
            "device_name": "Front desk Pixel",
            "platform": "android",
            "model": "Pixel 8",
            "os_version": "Android 15",
            "app_version": "1.0.0",
            "installation_id": installation_id or str(uuid.uuid4()),
        },
        headers=bearer(api_key),
    )
    assert r.status_code == 201, r.text
    return r.json()
