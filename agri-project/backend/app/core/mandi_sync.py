"""Load daily mandi prices into `mandi_prices`.

Two sources (MANDI_SOURCE): "dataset" (default) imports CSV files placed in the
dataset folder; "api" downloads from data.gov.in (Agmarknet). Values are stored
exactly as published (rupees per quintal). A load only writes when all of its
input was read successfully, so a failure never leaves partial data behind.
"""
import asyncio
import csv
import logging
import threading
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
from sqlalchemy import delete, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.core import geo
from app.core.config import settings
from app.core.database import SessionLocal, engine
from app.models.mandi import MandiPrice, MandiSyncRun

logger = logging.getLogger("smartag.mandi")

API_URL = "https://api.data.gov.in/resource/{resource}"
PAGE_SIZE = 1000
CHECK_EVERY_SECONDS = 30 * 60
DATASET_CHECK_SECONDS = 5 * 60
SOURCE_NAME = "data.gov.in — Agmarknet, Ministry of Agriculture & Farmers Welfare"

RETRY_WAITS = (5, 15, 30, 60, 0)

_run_lock = threading.Lock()


def _redact(text: str) -> str:
    """Never let the API key reach logs or the database."""
    key = settings.DATA_GOV_API_KEY.strip()
    return text.replace(key, "***") if key else text


def _parse_date(value: str) -> date | None:
    try:
        return datetime.strptime(value.strip(), "%d/%m/%Y").date()
    except (ValueError, AttributeError):
        return None


def _price(value) -> float | None:
    try:
        return float(value) if value not in (None, "", "NR") else None
    except (TypeError, ValueError):
        return None


def _clean(value, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _fetch_all() -> tuple[list[dict], int]:
    """Every record currently published, plus the feed's stated total."""
    url = API_URL.format(resource=settings.DATA_GOV_MANDI_RESOURCE)
    params = {"api-key": settings.DATA_GOV_API_KEY, "format": "json", "limit": PAGE_SIZE}
    records: list[dict] = []
    total = None
    with httpx.Client(timeout=httpx.Timeout(60.0, connect=15.0)) as client:
        offset = 0
        while total is None or offset < total:
            # data.gov.in has short outages (502s); back off and retry each page.
            for attempt, wait in enumerate(RETRY_WAITS):
                try:
                    response = client.get(url, params={**params, "offset": offset})
                    response.raise_for_status()
                    body = response.json()
                    break
                except (httpx.HTTPError, ValueError) as exc:
                    if attempt == len(RETRY_WAITS) - 1:
                        raise RuntimeError(f"data.gov.in request failed at offset {offset}: {_redact(str(exc))}") from None
                    time.sleep(wait)
            if body.get("status") not in (None, "ok"):
                raise RuntimeError(f"data.gov.in returned status {body.get('status')}: {body.get('message')}")
            page = body.get("records") or []
            total = int(body.get("total") or 0)
            records.extend(page)
            if not page:
                break
            offset += len(page)
    if total and len(records) < total:
        raise RuntimeError(f"Incomplete download: {len(records)} of {total} records")
    return records, total or 0


def _rows(records: list[dict]) -> list[dict]:
    rows, seen = [], set()
    for record in records:
        arrival = _parse_date(record.get("arrival_date", ""))
        row = {
            "state": _clean(record.get("state"), 80),
            "district": _clean(record.get("district"), 120),
            "market": _clean(record.get("market"), 160),
            "commodity": _clean(record.get("commodity"), 120),
            "variety": _clean(record.get("variety"), 120),
            "grade": _clean(record.get("grade"), 60),
            "arrival_date": arrival,
            "min_price": _price(record.get("min_price")),
            "max_price": _price(record.get("max_price")),
            "modal_price": _price(record.get("modal_price")),
        }
        if not (arrival and row["state"] and row["market"] and row["commodity"]):
            continue  # skip malformed rows rather than guessing
        key = tuple(row[k] for k in ("state", "district", "market", "commodity", "variety", "grade", "arrival_date"))
        if key in seen:
            continue
        seen.add(key)
        rows.append(row)
    return rows


def _upsert(db, rows: list[dict]) -> None:
    insert = pg_insert if engine.dialect.name == "postgresql" else sqlite_insert
    keys = ["state", "district", "market", "commodity", "variety", "grade", "arrival_date"]
    for start in range(0, len(rows), 1000):
        stmt = insert(MandiPrice).values(rows[start:start + 1000])
        stmt = stmt.on_conflict_do_update(
            index_elements=keys,
            set_={
                "min_price": stmt.excluded.min_price,
                "max_price": stmt.excluded.max_price,
                "modal_price": stmt.excluded.modal_price,
                "fetched_at": datetime.now(timezone.utc),
            },
        )
        db.execute(stmt)


def _store(fetch, label: str) -> MandiSyncRun | None:
    """Run one load (`fetch` returns (rows, source_total)). None if a load is already running."""
    if not _run_lock.acquire(blocking=False):
        return None
    db = SessionLocal()
    run = MandiSyncRun(started_at=datetime.now(timezone.utc), status="running")
    db.add(run)
    db.commit()
    try:
        rows, total = fetch()
        _upsert(db, rows)
        latest = max((row["arrival_date"] for row in rows), default=None)
        newest = db.query(func.max(MandiPrice.arrival_date)).scalar() or latest
        if newest:
            # Keep a rolling window counted back from the newest data, not from today.
            cutoff = newest - timedelta(days=settings.MANDI_RETENTION_DAYS)
            db.execute(delete(MandiPrice).where(MandiPrice.arrival_date < cutoff))
        run.status = "success"
        run.records = len(rows)
        run.source_total = total
        run.latest_arrival_date = latest
        run.finished_at = datetime.now(timezone.utc)
        db.commit()
        logger.info("Mandi prices loaded from %s: %s records, latest date %s", label, run.records, latest)
        # Find each market on OpenStreetMap in the background (cached, 1 lookup/second).
        geo.start_locating(sorted({(r["state"], r["district"], r["market"]) for r in rows}))
    except Exception as exc:
        db.rollback()
        run.status = "failed"
        run.error = _redact(f"{label}: {exc}")[:1000]
        run.finished_at = datetime.now(timezone.utc)
        db.add(run)
        db.commit()
        logger.error("Mandi price load failed: %s", run.error)
    finally:
        db.refresh(run)
        db.expunge(run)
        db.close()
        _run_lock.release()
    return run


def sync_now() -> MandiSyncRun | None:
    """Download the current day from the data.gov.in API."""
    if not settings.DATA_GOV_API_KEY.strip():
        raise RuntimeError("DATA_GOV_API_KEY is not set")

    def fetch():
        records, total = _fetch_all()
        return _rows(records), total

    return _store(fetch, "data.gov.in API")


# ---- Uploaded dataset files ------------------------------------------------
REQUIRED_COLUMNS = {"state", "district", "market", "commodity", "variety", "grade",
                    "arrival_date", "min_price", "max_price", "modal_price"}
_imported: dict[str, tuple[float, int]] = {}  # file path -> (mtime, size) already loaded


def dataset_dir() -> Path:
    if settings.MANDI_DATASET_DIR.strip():
        return Path(settings.MANDI_DATASET_DIR).expanduser().resolve()
    # Default: <repo>/dataset (next to agri-project/)
    return Path(__file__).resolve().parents[4] / "dataset"


def _dataset_files() -> list[Path]:
    folder = dataset_dir()
    return sorted(folder.glob("*.csv")) if folder.is_dir() else []


def _read_csv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        columns = {name.strip().lower() for name in (reader.fieldnames or [])}
        missing = REQUIRED_COLUMNS - columns
        if missing:
            raise RuntimeError(f"{path.name} is missing columns: {', '.join(sorted(missing))}")
        return [{(k or "").strip().lower(): v for k, v in row.items()} for row in reader]


def import_dataset(force: bool = False) -> MandiSyncRun | None:
    """Load new or changed CSV files from the dataset folder (exact values, no estimates)."""
    pending = []
    for path in _dataset_files():
        stat = path.stat()
        signature = (stat.st_mtime, stat.st_size)
        if force or _imported.get(str(path)) != signature:
            pending.append((path, signature))
    if not pending:
        return None

    def fetch():
        records = []
        for path, _sig in pending:
            records.extend(_read_csv(path))
        return _rows(records), len(records)

    names = ", ".join(path.name for path, _ in pending)
    run = _store(fetch, f"dataset ({names})")
    if run and run.status == "success":
        for path, signature in pending:
            _imported[str(path)] = signature
    return run


def source() -> str:
    return "api" if settings.MANDI_SOURCE.strip().lower() == "api" else "dataset"


def configured() -> bool:
    if source() == "api":
        return bool(settings.DATA_GOV_API_KEY.strip())
    return bool(_dataset_files())


def source_name() -> str:
    if source() == "api":
        return SOURCE_NAME
    return f"Uploaded dataset ({SOURCE_NAME} export)"


def run_now(force: bool = True) -> MandiSyncRun | None:
    return sync_now() if source() == "api" else import_dataset(force=force)


def is_running() -> bool:
    return _run_lock.locked()


def _mark_interrupted_runs() -> None:
    """Runs left 'running' by a restart can never finish; record them as failed."""
    db = SessionLocal()
    try:
        db.query(MandiSyncRun).filter(MandiSyncRun.status == "running").update(
            {MandiSyncRun.status: "failed", MandiSyncRun.error: "Interrupted by a server restart",
             MandiSyncRun.finished_at: datetime.now(timezone.utc)},
            synchronize_session=False,
        )
        db.commit()
    finally:
        db.close()


def _api_due() -> bool:
    db = SessionLocal()
    try:
        last = (
            db.query(MandiSyncRun)
            .filter(MandiSyncRun.status == "success")
            .order_by(MandiSyncRun.started_at.desc())
            .first()
        )
    finally:
        db.close()
    if last is None:
        return True
    started = last.started_at if last.started_at.tzinfo else last.started_at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - started >= timedelta(hours=settings.MANDI_SYNC_INTERVAL_HOURS)


async def _scheduler() -> None:
    await asyncio.to_thread(_mark_interrupted_runs)
    while True:
        try:
            if not is_running():
                if source() == "api":
                    if configured() and await asyncio.to_thread(_api_due):
                        await asyncio.to_thread(sync_now)
                else:
                    await asyncio.to_thread(import_dataset)
        except Exception:
            logger.exception("Mandi price scheduler error")
        # Dataset files are cheap to check; the API is polled less often.
        await asyncio.sleep(CHECK_EVERY_SECONDS if source() == "api" else DATASET_CHECK_SECONDS)


def install(app) -> None:
    """Load prices on startup, then keep them current in the background."""

    @app.on_event("startup")
    async def start_mandi_scheduler():
        app.state.mandi_task = asyncio.create_task(_scheduler())

    @app.on_event("shutdown")
    async def stop_mandi_scheduler():
        task = getattr(app.state, "mandi_task", None)
        if task:
            task.cancel()
