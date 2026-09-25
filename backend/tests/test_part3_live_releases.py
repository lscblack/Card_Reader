"""Part 3 §8 live stream, §9 app releases (subprocess mocked), §10 notifications."""

from __future__ import annotations

import asyncio
import hashlib
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
import respx
from httpx import AsyncClient

from app.core.config import settings
from app.db.session import SessionLocal
from app.services import app_builds, live
from tests.conftest import bearer, create_app, register, register_device
from tests.p2_helpers import BROWSER_UA, create_card, pair_business_device, register_business


async def _admin(client: AsyncClient) -> dict[str, str]:
    r = await client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": "AdminPassword123"})
    return bearer(r.json()["access_token"])


async def _stream_messages(app_id: str) -> list[dict]:  # type: ignore[type-arg]
    await live.wait_published()
    rows = await live.replay(app_id, datetime.now(UTC) - timedelta(minutes=5))
    return [m for _, m in rows]


# ══ Live stream ════════════════════════════════════════════════════════════
async def test_live_publishes_event_and_delivery_with_payload(client: AsyncClient, user: dict) -> None:
    created = await create_app(client, user["headers"])
    app_id = created["application"]["id"]
    await client.put(f"/api/v1/applications/{app_id}/endpoint", json={"url": "https://hooks.example.com/live",
                                                                       "enabled": True}, headers=user["headers"])
    dev = await register_device(client, created["api_key_plaintext"])
    body = {"event_id": str(uuid.uuid4()), "card_id": "04AABBCCDD", "card_type": "ntag215",
            "detected_at": datetime.now(UTC).isoformat()}
    with respx.mock() as mock:
        mock.post("https://hooks.example.com/live").mock(
            return_value=httpx.Response(202, json={"ok": True}, headers={"X-Secret": "hidden"}))
        await client.post("/api/v1/device/events", json=body, headers=bearer(dev["device_token"]))
    msgs = await _stream_messages(app_id)
    types = [m["type"] for m in msgs]
    assert types == ["event.received", "delivery.attempt"]
    received, attempt = msgs[0]["data"], msgs[1]["data"]
    assert received["event_id"] == body["event_id"] and received["device_name"] == "Front desk Pixel"
    assert received["card_id"] == "04AABBCCDD" and received["delivery_mode"] == "relay"
    assert attempt["success"] is True and attempt["status_code"] == 202 and attempt["attempt"] == 1
    assert attempt["request_payload"]["event_id"] == body["event_id"] and attempt["request_payload"]["card_id"] == "04AABBCCDD"
    assert attempt["response_excerpt"] == '{"ok":true}'
    assert set(attempt["response_headers"]) <= {"content-type", "content-length"} and "x-secret" not in attempt["response_headers"]


async def test_live_business_taps_and_sandbox_requests(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    owner = await register_business(client)
    dev = await pair_business_device(client, owner)
    card = await create_card(client, owner, name="Desk card", uid="04ABCDEF01")
    await client.get(f"/t/{card['public_code']}", headers={"User-Agent": BROWSER_UA})
    await client.post("/api/v1/device/events", headers=dev["headers"], json={
        "event_id": str(uuid.uuid4()), "card_id": "04ABCDEF01", "detected_at": datetime.now(UTC).isoformat()})
    msgs = await _stream_messages(dev["app_id"])
    taps = [m["data"] for m in msgs if m["type"] == "business.tap"]
    assert [t["source"] for t in taps] == ["web", "reader"] and taps[0]["card_name"] == "Desk card"

    monkeypatch.setattr(settings, "PUBLIC_API_URL", "http://127.0.0.1:8000")
    user = await register(client)
    h = bearer(user["access_token"])
    app_id = (await create_app(client, h))["application"]["id"]
    ep = (await client.get("/api/v1/sandbox/endpoints", headers=h)).json()[0]
    await client.post(f"/api/v1/sandbox/endpoints/{ep['id']}/use-for/{app_id}", headers=h)
    await client.post(f"/sandbox/{ep['token']}", json={"unsigned": True})
    sb = [m["data"] for m in await _stream_messages(app_id) if m["type"] == "sandbox.request"]
    assert sb[0]["endpoint_id"] == ep["id"] and sb[0]["signature_status"] == "missing"
    assert sb[0]["checks_failed"] >= 3 and sb[0]["response_status"] == 200


async def test_live_event_stream_generator(client: AsyncClient) -> None:
    app_id = str(uuid.uuid4())
    await live.publish(app_id, "event.received", {"event_id": "old"})
    since = datetime.now(UTC) - timedelta(minutes=1)
    frames: list[str] = []
    stop = asyncio.Event()

    async def disconnected() -> bool:
        return stop.is_set()

    async def consume() -> None:
        async for frame in live.event_stream(app_id, since, disconnected, heartbeat=0.2, poll=0.05):
            frames.append(frame)

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.15)
    await live.publish(app_id, "delivery.attempt", {"event_id": "new"})
    await asyncio.sleep(0.4)
    stop.set()
    await asyncio.wait_for(task, timeout=3)
    text = "".join(frames)
    assert frames[0] == "retry: 3000\n\n"
    assert "event: event.received" in text and '"event_id":"old"' in text  # replayed
    assert "event: delivery.attempt" in text and '"event_id":"new"' in text  # live
    assert ": ping" in text  # heartbeat
    old_frame = next(f for f in frames if '"old"' in f)
    assert old_frame.startswith("id: ")


async def test_live_endpoint_auth_limits_and_unavailable(client: AsyncClient, user: dict,
                                                         monkeypatch: pytest.MonkeyPatch) -> None:
    app_id = (await create_app(client, user["headers"]))["application"]["id"]
    other = await register(client)
    r = await client.get(f"/api/v1/live/applications/{app_id}", headers=bearer(other["access_token"]))
    assert r.status_code == 404
    assert (await client.get(f"/api/v1/live/applications/{app_id}")).status_code == 401
    for _ in range(5):
        assert await live.acquire_slot(uuid.UUID(user["user"]["id"]))
    r = await client.get(f"/api/v1/live/applications/{app_id}", headers=user["headers"])
    assert r.status_code == 429 and r.json()["error"]["code"] == "too_many_streams" and r.json()["error"]["ref"] == "NFC-4003"
    for _ in range(5):
        await live.release_slot(uuid.UUID(user["user"]["id"]))

    async def down() -> bool:
        return False

    monkeypatch.setattr("app.api.v1.routes.live_notifications.redis_ok", down)
    r = await client.get(f"/api/v1/live/applications/{app_id}", headers=user["headers"])
    assert r.status_code == 503 and r.json()["error"]["code"] == "live_unavailable"


# ══ App releases ═══════════════════════════════════════════════════════════
@pytest.fixture
def build_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    project = tmp_path / "mobile"
    project.mkdir()
    (project / "pubspec.yaml").write_text("name: nfc_terminal\nversion: 2.3.4+9\n")
    monkeypatch.setattr(settings, "APP_BUILD_ENABLED", True)
    monkeypatch.setattr(settings, "MOBILE_PROJECT_DIR", str(project))
    monkeypatch.setattr(settings, "FLUTTER_BIN", "/opt/flutter/bin/flutter")
    monkeypatch.setattr(settings, "JAVA_HOME", "/usr/lib/jvm/java-17-openjdk-amd64")
    return project


def _fake_runner(project: Path, code: int = 0, write_apk: bool = True, seen: list | None = None):  # type: ignore[no-untyped-def,type-arg]
    async def run(argv, cwd, env, on_line, should_cancel, timeout):  # type: ignore[no-untyped-def]
        if seen is not None:
            seen.append((argv, cwd, env))
        on_line("Running Gradle task 'assembleRelease'...")
        if write_apk:
            out = project / "build/app/outputs/flutter-apk"
            out.mkdir(parents=True, exist_ok=True)
            (out / f"app-{argv[3].lstrip('-')}.apk").write_bytes(b"PK\x03\x04fake-apk")
        on_line("✓ Built build/app/outputs/flutter-apk/app-release.apk")
        return code, None

    return run


async def test_app_release_build_publish_and_download(client: AsyncClient, user: dict, build_env: Path,
                                                      monkeypatch: pytest.MonkeyPatch) -> None:
    admin = await _admin(client)
    assert (await client.get("/api/v1/meta/app-release")).json()["error"]["code"] == "no_release"
    seen: list = []  # type: ignore[type-arg]
    monkeypatch.setattr(app_builds, "run_command", _fake_runner(build_env, seen=seen))

    r = await client.post("/api/v1/admin/app-releases", json={"build_type": "release", "channel": "stable",
                                                               "notes": "First", "publish_on_success": True}, headers=admin)
    assert r.status_code == 202, r.text
    rel = r.json()
    assert rel["status"] == "queued" and rel["version_name"] == "2.3.4" and rel["build_number"] == 1
    assert rel["api_base_url"] == "http://testserver" and rel["download_url"] is None
    r = await client.post("/api/v1/admin/app-releases", json={}, headers=admin)
    assert r.status_code == 409 and r.json()["error"]["code"] == "build_in_progress"

    assert await app_builds.maybe_start(SessionLocal) is True
    await asyncio.wait_for(app_builds._running, timeout=10)  # type: ignore[arg-type]
    argv, cwd, env = seen[0]
    assert argv == ["/opt/flutter/bin/flutter", "build", "apk", "--release", "--build-name=2.3.4", "--build-number=1",
                    "--dart-define=API_BASE_URL=http://testserver"]
    assert cwd == str(build_env) and env["JAVA_HOME"] == "/usr/lib/jvm/java-17-openjdk-amd64"
    assert env["PATH"].split(":")[0] == "/opt/flutter/bin" and "/usr/lib/jvm/java-17-openjdk-amd64/bin" in env["PATH"]
    assert "HOME" in env and "DATABASE_URL" not in env and "JWT_SECRET" not in env

    done = (await client.get(f"/api/v1/admin/app-releases/{rel['id']}?log=full", headers=admin)).json()
    assert done["status"] == "succeeded" and done["is_published"] is True and done["file_size"] == 12
    assert done["sha256"] == hashlib.sha256(b"PK\x03\x04fake-apk").hexdigest()
    assert "assembleRelease" in done["log"] and done["log_excerpt"].startswith("$ /opt/flutter/bin/flutter")
    meta = (await client.get("/api/v1/meta/app-release")).json()
    assert meta["version_name"] == "2.3.4" and meta["min_android"] == "7.0"
    assert meta["download_url"] == "http://testserver/downloads/android/latest"
    dl = await client.get("/downloads/android/latest")
    assert dl.status_code == 200 and dl.content == b"PK\x03\x04fake-apk"
    assert dl.headers["content-type"] == "application/vnd.android.package-archive"
    assert 'filename="nfc-terminal-2.3.4.apk"' in dl.headers["content-disposition"]
    assert (await client.get(f"/downloads/android/{rel['id']}")).status_code == 200
    assert (await client.get(f"/api/v1/admin/app-releases/{rel['id']}", headers=admin)).json()["downloads"] == 2

    # notifications for the admin who started it
    n = (await client.get("/api/v1/notifications?unread=true", headers=admin)).json()
    assert n["total"] == 1 and n["items"][0]["type"] == "app_build.succeeded" and n["items"][0]["severity"] == "success"
    assert (await client.get("/api/v1/notifications/unread-count", headers=admin)).json() == {"unread": 1}

    # delete rules, unpublish
    r = await client.delete(f"/api/v1/admin/app-releases/{rel['id']}", headers=admin)
    assert r.status_code == 409 and r.json()["error"]["code"] == "release_published"
    await client.post(f"/api/v1/admin/app-releases/{rel['id']}/unpublish", headers=admin)
    assert (await client.get("/downloads/android/latest")).status_code == 404
    assert (await client.delete(f"/api/v1/admin/app-releases/{rel['id']}", headers=admin)).status_code == 204
    assert (await client.get("/api/v1/admin/app-releases", headers=user["headers"])).status_code == 403


async def test_app_release_failures_cancel_and_validation(client: AsyncClient, build_env: Path,
                                                          monkeypatch: pytest.MonkeyPatch) -> None:
    admin = await _admin(client)
    for body, field in (({"version_name": "1.0; rm -rf /"}, "body.version_name"),
                        ({"api_base_url": "http://x.example.com/$(id)"}, "body.api_base_url"),
                        ({"api_base_url": "ftp://x.example.com"}, "body.api_base_url")):
        r = await client.post("/api/v1/admin/app-releases", json=body, headers=admin)
        assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == field, body

    monkeypatch.setattr(app_builds, "run_command", _fake_runner(build_env, code=1, write_apk=False))
    rel = (await client.post("/api/v1/admin/app-releases", json={"build_type": "debug", "build_number": 41},
                             headers=admin)).json()
    await app_builds.maybe_start(SessionLocal)
    await asyncio.wait_for(app_builds._running, timeout=10)  # type: ignore[arg-type]
    failed = (await client.get(f"/api/v1/admin/app-releases/{rel['id']}", headers=admin)).json()
    assert failed["status"] == "failed" and "exited with code 1" in failed["error"]
    r = await client.post(f"/api/v1/admin/app-releases/{rel['id']}/publish", headers=admin)
    assert r.status_code == 409 and r.json()["error"]["code"] == "release_not_ready"
    notes = (await client.get("/api/v1/notifications", headers=admin)).json()["items"]
    assert notes[0]["type"] == "app_build.failed" and notes[0]["severity"] == "error"

    rel2 = (await client.post("/api/v1/admin/app-releases", json={}, headers=admin)).json()
    assert rel2["build_number"] == 42  # auto-increment
    r = await client.post(f"/api/v1/admin/app-releases/{rel2['id']}/cancel", headers=admin)
    assert r.json()["status"] == "cancelled"
    assert await app_builds.maybe_start(SessionLocal) is False

    monkeypatch.setattr(settings, "APP_BUILD_ENABLED", False)
    r = await client.post("/api/v1/admin/app-releases", json={}, headers=admin)
    assert r.status_code == 403 and r.json()["error"]["code"] == "app_builds_disabled"


async def test_run_command_real_subprocess_timeout_and_cancel(tmp_path: Path) -> None:
    lines: list[str] = []

    async def never() -> bool:
        return False

    code, reason = await app_builds.run_command([sys.executable, "-c", "print('hello'); print('world')"], str(tmp_path),
                                                {"PATH": "/usr/bin:/bin"}, lines.append, never, timeout=20)
    assert (code, reason) == (0, None) and lines == ["hello", "world"]
    code, reason = await app_builds.run_command([sys.executable, "-c", "import time; time.sleep(30)"], str(tmp_path),
                                                {"PATH": "/usr/bin:/bin"}, lines.append, never, timeout=1)
    assert (code, reason) == (None, "timeout")

    async def cancel() -> bool:
        return True

    code, reason = await app_builds.run_command([sys.executable, "-c", "import time; time.sleep(30)"], str(tmp_path),
                                                {"PATH": "/usr/bin:/bin"}, lines.append, cancel, timeout=20)
    assert reason == "cancelled"


# ══ Notifications ══════════════════════════════════════════════════════════
async def test_notifications_endpoints(client: AsyncClient, user: dict) -> None:
    from app.services import notifications

    other = await register(client)
    async with SessionLocal() as s:
        notifications.notify(s, [uuid.UUID(user["user"]["id"])], type_="test.one", title="One", severity="info")
        notifications.notify(s, [uuid.UUID(user["user"]["id"])], type_="test.two", title="Two", severity="warning",
                             link="/x")
        await s.commit()
    h = user["headers"]
    assert (await client.get("/api/v1/notifications/unread-count", headers=h)).json() == {"unread": 2}
    items = (await client.get("/api/v1/notifications", headers=h)).json()["items"]
    assert {i["title"] for i in items} == {"One", "Two"} and all(i["read_at"] is None for i in items)
    r = await client.post(f"/api/v1/notifications/{items[0]['id']}/read", headers=bearer(other["access_token"]))
    assert r.status_code == 404
    r = await client.post(f"/api/v1/notifications/{items[0]['id']}/read", headers=h)
    assert r.json()["read_at"]
    assert (await client.get("/api/v1/notifications?unread=true", headers=h)).json()["total"] == 1
    assert (await client.post("/api/v1/notifications/read-all", headers=h)).status_code == 204
    assert (await client.get("/api/v1/notifications/unread-count", headers=h)).json() == {"unread": 0}
    assert (await client.get("/api/v1/notifications", headers=bearer(other["access_token"]))).json()["total"] == 0


def test_build_argv_rejects_injection() -> None:
    from app.models import AppRelease

    bad = [AppRelease(version_name="1.0.0 --foo", build_number=1, build_type="release", api_base_url="https://a.b"),
           AppRelease(version_name="1.0.0", build_number=1, build_type="profile", api_base_url="https://a.b"),
           AppRelease(version_name="1.0.0", build_number=0, build_type="release", api_base_url="https://a.b"),
           AppRelease(version_name="1.0.0", build_number=1, build_type="release", api_base_url="https://a.b/`id`")]
    for release in bad:
        with pytest.raises(app_builds.BuildArgError):
            app_builds.build_argv(release)
    ok = app_builds.build_argv(AppRelease(version_name="1.2.3-beta.1", build_number=7, build_type="debug",
                                          api_base_url="http://192.168.1.74:8000/"))
    assert ok[1:] == ["build", "apk", "--debug", "--build-name=1.2.3-beta.1", "--build-number=7",
                      "--dart-define=API_BASE_URL=http://192.168.1.74:8000"]
