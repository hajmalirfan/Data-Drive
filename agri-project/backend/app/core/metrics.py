"""Lightweight API request monitoring.

Requests are counted in memory per hour and flushed to the
``api_request_stats`` table periodically, so monitoring never adds a
database round-trip to each request.
"""
import asyncio
import logging
import threading
import time
from datetime import datetime, timezone

from app.core.database import SessionLocal
from app.models.metrics import ApiRequestStat

logger = logging.getLogger("smartag.metrics")

FLUSH_SECONDS = 60

_lock = threading.Lock()
# hour_start (naive UTC) -> [requests, client_errors, server_errors, total_ms]
_pending: dict[datetime, list[float]] = {}


def hour_start(moment: datetime) -> datetime:
    return moment.replace(minute=0, second=0, microsecond=0)


def record(status_code: int, duration_ms: float) -> None:
    bucket = hour_start(datetime.now(timezone.utc).replace(tzinfo=None))
    with _lock:
        row = _pending.setdefault(bucket, [0, 0, 0, 0.0])
        row[0] += 1
        if 400 <= status_code < 500:
            row[1] += 1
        elif status_code >= 500:
            row[2] += 1
        row[3] += duration_ms


def pending_snapshot() -> dict[datetime, list[float]]:
    """Counts not yet written to the database (merged into stats responses)."""
    with _lock:
        return {key: list(value) for key, value in _pending.items()}


def flush() -> None:
    with _lock:
        batch = dict(_pending)
        _pending.clear()
    if not batch:
        return
    db = SessionLocal()
    try:
        for bucket, (requests, client_errors, server_errors, total_ms) in batch.items():
            stat = db.get(ApiRequestStat, bucket)
            if stat is None:
                stat = ApiRequestStat(hour_start=bucket, requests=0, client_errors=0, server_errors=0, total_ms=0)
                db.add(stat)
            stat.requests = (stat.requests or 0) + int(requests)
            stat.client_errors = (stat.client_errors or 0) + int(client_errors)
            stat.server_errors = (stat.server_errors or 0) + int(server_errors)
            stat.total_ms = (stat.total_ms or 0) + float(total_ms)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Could not save request metrics; keeping them for the next flush")
        with _lock:
            for bucket, values in batch.items():
                row = _pending.setdefault(bucket, [0, 0, 0, 0.0])
                for index, value in enumerate(values):
                    row[index] += value
    finally:
        db.close()


async def flush_forever() -> None:
    while True:
        await asyncio.sleep(FLUSH_SECONDS)
        await asyncio.to_thread(flush)


def install(app) -> None:
    """Attach the counting middleware and the periodic flush to a FastAPI app."""

    @app.middleware("http")
    async def count_requests(request, call_next):
        # Only API calls; skip CORS preflights, they are browser noise.
        if not request.url.path.startswith("/api") or request.method == "OPTIONS":
            return await call_next(request)
        started = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            record(status_code, (time.perf_counter() - started) * 1000)

    @app.on_event("startup")
    async def start_flusher():
        app.state.metrics_task = asyncio.create_task(flush_forever())

    @app.on_event("shutdown")
    async def stop_flusher():
        task = getattr(app.state, "metrics_task", None)
        if task:
            task.cancel()
        await asyncio.to_thread(flush)
