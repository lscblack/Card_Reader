"""Image uploads (logos, employee photos) stored under MEDIA_ROOT and served at /media."""

from __future__ import annotations

import secrets
from pathlib import Path

from app.core.config import settings
from app.core.errors import AppError

_SIGNATURES = (
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff", "jpg"),
)


def media_root() -> Path:
    root = Path(settings.MEDIA_ROOT).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def sniff(data: bytes) -> str | None:
    for magic, ext in _SIGNATURES:
        if data.startswith(magic):
            return ext
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def save_image(data: bytes, folder: str, stem: str) -> str:
    """Validates and stores an image; returns the path relative to MEDIA_ROOT."""
    if len(data) > settings.MEDIA_MAX_UPLOAD_BYTES:
        raise AppError(422, "invalid_upload", "Images must be at most 2 MB",
                       [{"field": "file", "message": "file too large (max 2 MB)"}])
    ext = sniff(data)
    if ext is None:
        raise AppError(422, "invalid_upload", "Only PNG, JPEG or WebP images are accepted",
                       [{"field": "file", "message": "unsupported image type"}])
    rel = Path(folder) / f"{stem}-{secrets.token_hex(6)}.{ext}"
    target = media_root() / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return rel.as_posix()


def delete_file(rel: str | None) -> None:
    if not rel:
        return
    try:
        path = (media_root() / rel).resolve()
        if media_root() in path.parents:
            path.unlink(missing_ok=True)
    except OSError:
        pass


AVATAR_SIZE = 256


def save_avatar(data: bytes, owner_id: str) -> str:
    """Validates, centre-crops, resizes to 256×256 and re-encodes (WebP, metadata stripped)."""
    import io

    from PIL import Image, ImageOps, UnidentifiedImageError

    if len(data) > settings.MEDIA_MAX_UPLOAD_BYTES:
        raise AppError(422, "invalid_upload", "Images must be at most 2 MB",
                       [{"field": "file", "message": "file too large (max 2 MB)"}])
    if sniff(data) is None:
        raise AppError(422, "invalid_upload", "Only PNG, JPEG or WebP images are accepted",
                       [{"field": "file", "message": "unsupported image type"}])
    Image.MAX_IMAGE_PIXELS = 40_000_000  # decompression-bomb guard
    try:
        with Image.open(io.BytesIO(data)) as img:
            img = ImageOps.exif_transpose(img)
            img = img.convert("RGBA" if img.mode in ("RGBA", "LA", "P") else "RGB")
            img = ImageOps.fit(img, (AVATAR_SIZE, AVATAR_SIZE), method=Image.Resampling.LANCZOS)
            out = io.BytesIO()
            img.save(out, format="WEBP", quality=85, method=6)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise AppError(422, "invalid_upload", "The image could not be read",
                       [{"field": "file", "message": "corrupt or unsupported image"}]) from exc
    rel = Path("avatars") / f"{owner_id}-{secrets.token_hex(6)}.webp"
    target = media_root() / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(out.getvalue())
    return rel.as_posix()


def save_resized(data: bytes, folder: str, stem: str, size: tuple[int, int], crop: bool,
                 max_bytes: int = 3 * 1024 * 1024) -> str:
    """Validates (magic bytes), then crops-to-fill (crop=True) or fits inside `size`, re-encoding as WebP."""
    import io

    from PIL import Image, ImageOps, UnidentifiedImageError

    if len(data) > max_bytes:
        raise AppError(422, "invalid_upload", f"Images must be at most {max_bytes // (1024 * 1024)} MB",
                       [{"field": "file", "message": "file too large"}])
    if sniff(data) is None:
        raise AppError(422, "invalid_upload", "Only PNG, JPEG or WebP images are accepted",
                       [{"field": "file", "message": "unsupported image type"}])
    Image.MAX_IMAGE_PIXELS = 40_000_000
    try:
        with Image.open(io.BytesIO(data)) as img:
            img = ImageOps.exif_transpose(img)
            img = img.convert("RGBA" if img.mode in ("RGBA", "LA", "P") else "RGB")
            if crop:
                img = ImageOps.fit(img, size, method=Image.Resampling.LANCZOS)
            else:
                img.thumbnail(size, Image.Resampling.LANCZOS)
            out = io.BytesIO()
            img.save(out, format="WEBP", quality=86, method=6)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise AppError(422, "invalid_upload", "The image could not be read",
                       [{"field": "file", "message": "corrupt or unsupported image"}]) from exc
    rel = Path(folder) / f"{stem}-{secrets.token_hex(6)}.webp"
    target = media_root() / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(out.getvalue())
    return rel.as_posix()
