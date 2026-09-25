"""Standalone delivery retry worker.

    python -m app.workers.delivery

Set DELIVERY_WORKER_ENABLED=false on the API processes when running this separately.
Several workers may run concurrently: a per-event Redis lock prevents double processing.
"""

from __future__ import annotations

import asyncio
import logging
import signal

from app.core.config import settings
from app.core.logging import setup_logging
from app.core.redis import close_redis
from app.db.session import SessionLocal, engine
from app.services.delivery import close_http_client, run_worker

logger = logging.getLogger("app.workers.delivery")


async def main() -> None:
    setup_logging(settings.LOG_LEVEL, settings.log_json, settings.API_KEY_PREFIX)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:  # pragma: no cover - Windows
            pass
    try:
        await run_worker(SessionLocal, stop)
    finally:
        await close_http_client()
        await close_redis()
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
