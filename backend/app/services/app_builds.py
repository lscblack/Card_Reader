"""Mobile NFC Terminal builds (Part 3 §9).

The worker runs a *fixed* command — never a shell — with validated arguments:
    <FLUTTER_BIN> build apk --<release|debug> --build-name=<v> --build-number=<n> --dart-define=API_BASE_URL=<url>
in MOBILE_PROJECT_DIR, one build at a time (Redis lock), with a timeout, cancellation and log capture.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import shutil
import signal
from collections import deque
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import settings
from app.core.redis import get_redis
from app.models import AppRelease

logger = logging.getLogger("app.builds")

LOCK_KEY = "nfc:build:lock"
VERSION_RE = re.compile(r"^\d{1,4}\.\d{1,4}\.\d{1,4}(?:[-+][0-9A-Za-z.]{1,20})?$")
MAX_LOG_BYTES = 1024 * 1024
LOG_EXCERPT_LINES = 200
_running: asyncio.Task[None] | None = None


class BuildArgError(ValueError):
    pass


# ── Validation & command ───────────────────────────────────────────────────
def validate_version(value: str) -> str:
    if not VERSION_RE.match(value or ""):
        raise BuildArgError("version_name must look like 1.2.3 (optionally -beta.1)")
    return value


def validate_api_base_url(value: str) -> str:
    value = (value or "").strip().rstrip("/")
    try:
        parts = urlsplit(value)
    except ValueError as exc:
        raise BuildArgError("api_base_url is not a valid URL") from exc
    if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password \
            or parts.query or parts.fragment or len(value) > 300 or re.search(r"[\s'\"`$;&|<>\\]", value):
        raise BuildArgError("api_base_url must be a plain http(s) URL")
    return value


def build_argv(release: AppRelease) -> list[str]:
    """The exact argv (no shell). Every user-provided piece is validated before it gets here."""
    if release.build_type not in ("release", "debug"):
        raise BuildArgError("invalid build_type")
    if not isinstance(release.build_number, int) or not 1 <= release.build_number <= 2_100_000_000:
        raise BuildArgError("invalid build_number")
    return [
        settings.FLUTTER_BIN, "build", "apk", f"--{release.build_type}",
        f"--build-name={validate_version(release.version_name)}",
        f"--build-number={release.build_number}",
        f"--dart-define=API_BASE_URL={validate_api_base_url(release.api_base_url)}",
    ]


def build_env() -> dict[str, str]:
    """A small, explicit environment: HOME, PATH (flutter + java + system), JAVA_HOME, Android SDK, locale."""
    flutter_dir = str(Path(settings.FLUTTER_BIN).parent) if "/" in settings.FLUTTER_BIN else ""
    java_home = settings.JAVA_HOME or os.environ.get("JAVA_HOME", "")
    path = [p for p in (flutter_dir, f"{java_home}/bin" if java_home else "", "/snap/bin", "/usr/local/bin",
                        "/usr/bin", "/bin") if p]
    env = {"PATH": ":".join(dict.fromkeys(path)), "HOME": os.environ.get("HOME", "/tmp"),
           "LANG": os.environ.get("LANG", "C.UTF-8"), "CI": "true", "FLUTTER_SUPPRESS_ANALYTICS": "true"}
    if java_home:
        env["JAVA_HOME"] = java_home
    sdk = settings.ANDROID_SDK_ROOT or os.environ.get("ANDROID_SDK_ROOT") or os.environ.get("ANDROID_HOME")
    if sdk:
        env["ANDROID_SDK_ROOT"] = env["ANDROID_HOME"] = sdk
    for key in ("USER", "XDG_RUNTIME_DIR", "PUB_CACHE", "GRADLE_USER_HOME", "SNAP_USER_DATA"):
        if os.environ.get(key):
            env[key] = os.environ[key]
    return env


def default_version_name() -> str:
    try:
        text = (Path(settings.MOBILE_PROJECT_DIR) / "pubspec.yaml").read_text()
        m = re.search(r"^version:\s*([0-9]+\.[0-9]+\.[0-9]+)", text, re.M)
        if m:
            return m.group(1)
    except OSError:
        pass
    return "1.0.0"


async def next_build_number(session: AsyncSession) -> int:
    current = (await session.execute(select(func.max(AppRelease.build_number)))).scalar()
    return int(current or 0) + 1


def artifact_source(release: AppRelease) -> Path:
    return Path(settings.MOBILE_PROJECT_DIR) / "build" / "app" / "outputs" / "flutter-apk" / f"app-{release.build_type}.apk"


# ── Execution ──────────────────────────────────────────────────────────────
async def run_command(argv: list[str], cwd: str, env: dict[str, str], on_line: Callable[[str], None],
                      should_cancel: Callable[[], Awaitable[bool]], timeout: int) -> tuple[int | None, str | None]:
    """Runs argv without a shell. Returns (returncode, reason) where reason is 'timeout'/'cancelled'/None."""
    proc = await asyncio.create_subprocess_exec(
        *argv, cwd=cwd, env=env, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        start_new_session=True,
    )
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    reason: str | None = None
    assert proc.stdout is not None
    last_cancel_check = loop.time()
    while True:
        remaining = deadline - loop.time()
        if remaining <= 0:
            reason = "timeout"
            break
        try:
            line = await asyncio.wait_for(proc.stdout.readline(), timeout=min(2.0, remaining))
        except (TimeoutError, asyncio.TimeoutError):
            line = None
        if line == b"":
            break
        if line:
            on_line(line.decode("utf-8", "replace").rstrip("\n"))
        if loop.time() - last_cancel_check >= 2:
            last_cancel_check = loop.time()
            if await should_cancel():
                reason = "cancelled"
                break
    if reason:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            await asyncio.wait_for(proc.wait(), timeout=10)
        except (ProcessLookupError, TimeoutError, asyncio.TimeoutError):
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        return None, reason
    return await proc.wait(), None


async def _notify_finished(session: AsyncSession, release: AppRelease) -> None:
    from app.services import notifications

    ok = release.status == "succeeded"
    recipients = [*([release.created_by] if release.created_by else []), *await notifications.admin_ids(session)]
    notifications.notify(
        session, recipients, type_=f"app_build.{'succeeded' if ok else release.status}",
        title=f"NFC Terminal {release.version_name} ({release.build_number}) "
              f"{'built successfully' if ok else release.status}",
        body=(f"{release.build_type} APK, {round((release.file_size or 0) / 1_048_576, 1)} MB"
              + (" — published" if release.is_published else "")) if ok else (release.error or "Build failed"),
        link=f"/admin/app-releases/{release.id}", severity="success" if ok else "error",
    )


async def execute(session_factory: async_sessionmaker[AsyncSession], release_id) -> None:  # type: ignore[no-untyped-def]
    lines: deque[str] = deque(maxlen=20_000)
    log_bytes = 0

    def on_line(line: str) -> None:
        nonlocal log_bytes
        log_bytes += len(line) + 1
        lines.append(line)

    async def should_cancel() -> bool:
        async with session_factory() as s:
            status = (await s.execute(select(AppRelease.status).where(AppRelease.id == release_id))).scalar()
        return status == "cancelled"

    async with session_factory() as session:
        release = await session.get(AppRelease, release_id)
        if release is None or release.status != "queued":
            return
        release.status, release.started_at = "building", datetime.now(UTC)
        await session.commit()
        try:
            argv = build_argv(release)
            project = settings.MOBILE_PROJECT_DIR
            if not project or not Path(project, "pubspec.yaml").exists():
                raise BuildArgError("MOBILE_PROJECT_DIR does not contain a Flutter project")
            on_line("$ " + " ".join(argv))
            code, reason = await run_command(argv, project, build_env(), on_line, should_cancel,
                                             settings.APP_BUILD_TIMEOUT_SECONDS)
            if reason == "cancelled":
                release.status, release.error = "cancelled", "Cancelled by an administrator"
            elif reason == "timeout":
                release.status, release.error = "failed", f"Timed out after {settings.APP_BUILD_TIMEOUT_SECONDS}s"
            elif code != 0:
                release.status, release.error = "failed", f"flutter exited with code {code}"
            else:
                src = artifact_source(release)
                if not src.exists():
                    raise FileNotFoundError(f"artifact not found: {src.name}")
                from app.services.media import media_root

                rel = f"releases/nfc-terminal-{release.version_name}-{release.build_number}-{release.build_type}.apk"
                dest = media_root() / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(src, dest)
                digest = hashlib.sha256()
                with dest.open("rb") as fh:
                    for chunk in iter(lambda: fh.read(1 << 20), b""):
                        digest.update(chunk)
                release.artifact_path, release.sha256 = rel, digest.hexdigest()
                release.file_size = dest.stat().st_size
                release.status = "succeeded"
                if release.publish_on_success:
                    release.is_published, release.published_at = True, datetime.now(UTC)
        except (BuildArgError, OSError) as exc:
            release.status, release.error = "failed", str(exc)[:500]
            on_line(f"error: {exc}")
        except Exception as exc:  # pragma: no cover
            logger.exception("Build crashed")
            release.status, release.error = "failed", f"internal error: {exc.__class__.__name__}"
        full = "\n".join(lines)
        release.log = full[-MAX_LOG_BYTES:]
        release.finished_at = datetime.now(UTC)
        await _notify_finished(session, release)
        await session.commit()
        logger.info("App build %s finished: %s", release.id, release.status)


async def recover_orphans(session_factory: async_sessionmaker[AsyncSession]) -> int:
    """On worker start: `building` rows with no live build lock were interrupted (restart/crash) → failed."""
    if _running is not None and not _running.done():
        return 0
    try:
        if await get_redis().exists(LOCK_KEY):
            return 0
    except Exception:
        pass
    async with session_factory() as session:
        rows = (await session.execute(select(AppRelease).where(AppRelease.status == "building"))).scalars().all()
        for release in rows:
            release.status = "failed"
            release.error = "Build interrupted (worker restarted)"
            release.finished_at = datetime.now(UTC)
            await _notify_finished(session, release)
        await session.commit()
    if rows:
        logger.warning("Marked %d interrupted app build(s) as failed", len(rows))
    return len(rows)


async def maybe_start(session_factory: async_sessionmaker[AsyncSession]) -> bool:
    """Called from the worker loop: starts the oldest queued build if none is running (cluster-wide lock)."""
    global _running
    if not settings.APP_BUILD_ENABLED or (_running is not None and not _running.done()):
        return False
    async with session_factory() as session:
        release_id = (await session.execute(select(AppRelease.id).where(AppRelease.status == "queued")
                                            .order_by(AppRelease.created_at).limit(1))).scalar()
    if release_id is None:
        return False
    try:
        got = await get_redis().set(LOCK_KEY, str(release_id), nx=True, ex=settings.APP_BUILD_TIMEOUT_SECONDS + 120)
    except Exception:
        return False
    if not got:
        return False

    async def runner() -> None:
        try:
            await execute(session_factory, release_id)
        finally:
            try:
                await get_redis().delete(LOCK_KEY)
            except Exception:
                pass

    _running = asyncio.create_task(runner(), name=f"app-build-{release_id}")
    return True


def excerpt(log: str | None, lines: int = LOG_EXCERPT_LINES) -> str | None:
    if not log:
        return None
    return "\n".join(log.splitlines()[-lines:])
