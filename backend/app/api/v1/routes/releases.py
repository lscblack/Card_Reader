"""nexTap app releases (Part 3 §9): public download + admin builds."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Query, Request, Response
from fastapi.responses import FileResponse
from pydantic import Field
from sqlalchemy import select, update

from app.api.deps import AdminUser, ClientDep, PaginationDep, SessionDep
from app.core.config import settings
from app.core.errors import AppError, not_found, validation_error
from app.models import AppRelease
from app.schemas.common import Schema
from app.services import app_builds, audit
from app.services.request_logs import set_actor

router = APIRouter(tags=["App releases"])
root_router = APIRouter(tags=["App releases"])
admin_router = APIRouter(prefix="/admin/app-releases", tags=["Admin"])

MIN_ANDROID = "7.0"


def _iso(d: datetime | None) -> str | None:
    return d.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ") if d else None


def download_url(r: AppRelease) -> str | None:
    if r.status != "succeeded" or not r.artifact_path:
        return None
    return f"{settings.public_api_url}/downloads/android/{r.id}"


def release_out(r: AppRelease, full_log: bool = False) -> dict[str, Any]:
    out = {"id": str(r.id), "version_name": r.version_name, "build_number": r.build_number, "channel": r.channel,
           "build_type": r.build_type, "api_base_url": r.api_base_url, "file_size": r.file_size, "sha256": r.sha256,
           "status": r.status, "is_published": r.is_published, "publish_on_success": r.publish_on_success,
           "published_at": _iso(r.published_at), "notes": r.notes, "error": r.error,
           "log_excerpt": app_builds.excerpt(r.log), "downloads": r.downloads, "started_at": _iso(r.started_at),
           "finished_at": _iso(r.finished_at), "created_by": str(r.created_by) if r.created_by else None,
           "created_at": _iso(r.created_at), "download_url": download_url(r)}
    if full_log:
        out["log"] = r.log
    return out


async def _latest_published(session: SessionDep) -> AppRelease | None:
    return (await session.execute(
        select(AppRelease).where(AppRelease.is_published.is_(True), AppRelease.channel == "stable",
                                 AppRelease.status == "succeeded")
        .order_by(AppRelease.build_number.desc(), AppRelease.created_at.desc()).limit(1))).scalar_one_or_none()


@router.get("/meta/app-release", summary="Latest published nexTap APK (public)")
async def latest_release(session: SessionDep, request: Request) -> dict[str, Any]:
    set_actor(request, "public")
    r = await _latest_published(session)
    if r is None:
        raise AppError(404, "no_release", "No nexTap release has been published yet")
    return {"version_name": r.version_name, "build_number": r.build_number, "file_size": r.file_size,
            "sha256": r.sha256, "published_at": _iso(r.published_at), "download_url":
            f"{settings.public_api_url}/downloads/android/latest", "min_android": MIN_ANDROID}


async def _serve(session: SessionDep, r: AppRelease | None) -> Response:
    if r is None or not r.artifact_path or r.status != "succeeded":
        raise AppError(404, "no_release", "Release not available")
    path = app_builds.artifact_file(r.artifact_path).resolve()
    if app_builds.releases_root() not in path.parents or not path.exists():
        raise AppError(404, "no_release", "Release file missing")
    await session.execute(update(AppRelease).where(AppRelease.id == r.id).values(downloads=AppRelease.downloads + 1))
    await session.commit()
    return FileResponse(path, media_type="application/vnd.android.package-archive",
                        filename=f"nextap-{r.version_name}.apk",
                        headers={"Cache-Control": "no-store", "X-Content-SHA256": r.sha256 or ""})


@root_router.get("/downloads/android/latest", summary="Download the latest published APK")
async def download_latest(session: SessionDep, request: Request) -> Response:
    set_actor(request, "public")
    return await _serve(session, await _latest_published(session))


@root_router.get("/downloads/android/{release_id}", summary="Download a published APK")
async def download_release(release_id: uuid.UUID, session: SessionDep, request: Request) -> Response:
    set_actor(request, "public")
    r = await session.get(AppRelease, release_id)
    if r is None or not r.is_published:
        raise AppError(404, "no_release", "Release not available")
    return await _serve(session, r)


# ── Admin ───────────────────────────────────────────────────────────────
class ReleaseIn(Schema):
    version_name: str | None = Field(default=None, max_length=32)
    build_number: int | None = Field(default=None, ge=1, le=2_100_000_000)
    build_type: Literal["release", "debug"] = "release"
    channel: Literal["stable", "beta"] = "stable"
    api_base_url: str | None = Field(default=None, max_length=300)
    notes: str | None = Field(default=None, max_length=2000)
    publish_on_success: bool = False


async def _get(session: SessionDep, release_id: uuid.UUID) -> AppRelease:
    r = await session.get(AppRelease, release_id)
    if r is None:
        raise not_found("Release")
    return r


@admin_router.post("", status_code=202, summary="Queue an APK build")
async def create_release(body: ReleaseIn, admin: AdminUser, session: SessionDep, client: ClientDep) -> dict[str, Any]:
    if not settings.APP_BUILD_ENABLED:
        raise AppError(403, "app_builds_disabled", "App builds are disabled on this server (APP_BUILD_ENABLED)")
    busy = (await session.execute(select(AppRelease.id).where(AppRelease.status.in_(("queued", "building")))
                                  .limit(1))).first()
    if busy:
        raise AppError(409, "build_in_progress", "Another build is queued or running")
    try:
        version = app_builds.validate_version(body.version_name or app_builds.default_version_name())
    except app_builds.BuildArgError as exc:
        raise validation_error("body.version_name", str(exc)) from None
    try:
        api_url = app_builds.validate_api_base_url(body.api_base_url or settings.public_api_url, body.build_type)
    except app_builds.BuildArgError as exc:
        raise validation_error("body.api_base_url", str(exc)) from None
    release = AppRelease(version_name=version, build_number=body.build_number or await app_builds.next_build_number(session),
                         channel=body.channel, build_type=body.build_type, api_base_url=api_url, status="queued",
                         is_published=False, publish_on_success=body.publish_on_success, notes=body.notes,
                         downloads=0, created_by=admin.id)
    session.add(release)
    await session.flush()
    audit.record(session, action="admin.app_release_create", user_id=admin.id, client=client,
                 resource_type="app_release", resource_id=release.id,
                 metadata={"version_name": version, "build_number": release.build_number, "build_type": body.build_type})
    await session.commit()
    await session.refresh(release)
    return release_out(release)


@admin_router.get("", summary="All releases / builds")
async def list_releases(admin: AdminUser, session: SessionDep, pagination: PaginationDep) -> dict[str, Any]:
    from sqlalchemy import func

    total = (await session.execute(select(func.count()).select_from(AppRelease))).scalar_one()
    rows = (await session.execute(select(AppRelease).order_by(AppRelease.created_at.desc())
                                  .offset(pagination.offset).limit(pagination.page_size))).scalars()
    return {"items": [release_out(r) for r in rows], "total": total, "page": pagination.page,
            "page_size": pagination.page_size}


@admin_router.get("/{release_id}", summary="One release (`?log=full` for the whole build log)")
async def get_release(release_id: uuid.UUID, admin: AdminUser, session: SessionDep,
                      log: Literal["excerpt", "full"] = Query(default="excerpt")) -> dict[str, Any]:
    return release_out(await _get(session, release_id), full_log=log == "full")


@admin_router.post("/{release_id}/cancel", summary="Cancel a queued or running build")
async def cancel_release(release_id: uuid.UUID, admin: AdminUser, session: SessionDep, client: ClientDep) -> dict[str, Any]:
    r = await _get(session, release_id)
    if r.status in ("queued", "building"):
        r.status, r.error = "cancelled", "Cancelled by an administrator"
        if r.started_at is None:
            r.finished_at = datetime.now(UTC)
        audit.record(session, action="admin.app_release_cancel", user_id=admin.id, client=client,
                     resource_type="app_release", resource_id=r.id)
        await session.commit()
    return release_out(r)


async def _publish(release_id: uuid.UUID, admin, session: SessionDep, client: ClientDep, publish: bool) -> dict[str, Any]:  # type: ignore[no-untyped-def]
    r = await _get(session, release_id)
    if publish and r.status != "succeeded":
        raise AppError(409, "release_not_ready", "Only successful builds can be published")
    r.is_published = publish
    r.published_at = datetime.now(UTC) if publish else None
    audit.record(session, action=f"admin.app_release_{'publish' if publish else 'unpublish'}", user_id=admin.id,
                 client=client, resource_type="app_release", resource_id=r.id)
    await session.commit()
    return release_out(r)


@admin_router.post("/{release_id}/publish", summary="Publish a successful build")
async def publish_release(release_id: uuid.UUID, admin: AdminUser, session: SessionDep, client: ClientDep) -> dict[str, Any]:
    return await _publish(release_id, admin, session, client, True)


@admin_router.post("/{release_id}/unpublish", summary="Unpublish a build")
async def unpublish_release(release_id: uuid.UUID, admin: AdminUser, session: SessionDep, client: ClientDep) -> dict[str, Any]:
    return await _publish(release_id, admin, session, client, False)


@admin_router.delete("/{release_id}", status_code=204, summary="Delete a release (not the published one)")
async def delete_release(release_id: uuid.UUID, admin: AdminUser, session: SessionDep, client: ClientDep) -> Response:
    r = await _get(session, release_id)
    if r.is_published:
        raise AppError(409, "release_published", "Unpublish the release before deleting it")
    if r.status == "building":
        raise AppError(409, "build_in_progress", "Cancel the running build first")
    app_builds.delete_artifact(r.artifact_path)
    audit.record(session, action="admin.app_release_delete", user_id=admin.id, client=client,
                 resource_type="app_release", resource_id=r.id)
    await session.delete(r)
    await session.commit()
    return Response(status_code=204)
