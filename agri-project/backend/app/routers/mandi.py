"""Government mandi prices (data.gov.in / Agmarknet), as published."""
from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core import mandi_sync
from app.core.database import get_db
from app.core.security_policy import audit, rate_limit
from app.models.mandi import MandiPrice, MandiSyncRun
from app.models.user import User
from app.routers.auth import get_current_user, require_admin

router = APIRouter(prefix="/api/mandi-prices", tags=["mandi prices"])

SORTS = {
    "commodity": (MandiPrice.commodity.asc(), MandiPrice.market.asc()),
    "market": (MandiPrice.market.asc(), MandiPrice.commodity.asc()),
    "modal_desc": (MandiPrice.modal_price.desc().nulls_last(), MandiPrice.market.asc()),
    "modal_asc": (MandiPrice.modal_price.asc().nulls_last(), MandiPrice.market.asc()),
}


def _latest_date(db: Session) -> date | None:
    return db.query(func.max(MandiPrice.arrival_date)).scalar()


def _filtered(db: Session, arrival: date | None, state, district, market, commodity, q):
    query = db.query(MandiPrice)
    if arrival:
        query = query.filter(MandiPrice.arrival_date == arrival)
    if state:
        query = query.filter(MandiPrice.state == state)
    if district:
        query = query.filter(MandiPrice.district == district)
    if market:
        query = query.filter(MandiPrice.market == market)
    if commodity:
        query = query.filter(MandiPrice.commodity == commodity)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            MandiPrice.market.ilike(like) | MandiPrice.commodity.ilike(like)
            | MandiPrice.variety.ilike(like) | MandiPrice.district.ilike(like)
        )
    return query


def _row(price: MandiPrice) -> dict:
    return {
        "id": price.id,
        "state": price.state,
        "district": price.district,
        "market": price.market,
        "commodity": price.commodity,
        "variety": price.variety,
        "grade": price.grade,
        "arrival_date": price.arrival_date.isoformat(),
        "min_price": price.min_price,
        "max_price": price.max_price,
        "modal_price": price.modal_price,
    }


@router.get("")
def list_mandi_prices(
    arrival_date: date | None = Query(None, description="Defaults to the latest published date"),
    state: str | None = None,
    district: str | None = None,
    market: str | None = None,
    commodity: str | None = None,
    q: str | None = Query(None, max_length=80),
    sort: str = "commodity",
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    arrival = arrival_date or _latest_date(db)
    query = _filtered(db, arrival, state, district, market, commodity, q)
    total = query.count()
    stats = query.with_entities(
        func.count(func.distinct(MandiPrice.state + "|" + MandiPrice.district + "|" + MandiPrice.market)),
        func.count(func.distinct(MandiPrice.commodity)),
        func.max(MandiPrice.modal_price),
        func.avg(MandiPrice.modal_price),
    ).first()
    items = query.order_by(*SORTS.get(sort, SORTS["commodity"])).offset(offset).limit(limit).all()
    return {
        "arrival_date": arrival.isoformat() if arrival else None,
        "unit": "Rs/quintal",
        "source": mandi_sync.source_name(),
        "total": total,
        "markets": stats[0] or 0,
        "commodities": stats[1] or 0,
        "max_modal": stats[2],
        "avg_modal": round(stats[3], 2) if stats[3] is not None else None,
        "items": [_row(item) for item in items],
    }


@router.get("/filters")
def mandi_filters(
    state: str | None = None,
    district: str | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Options for the filter dropdowns, from the latest published date."""
    arrival = _latest_date(db)
    base = db.query(MandiPrice).filter(MandiPrice.arrival_date == arrival) if arrival else db.query(MandiPrice).filter(False)
    states = [row[0] for row in base.with_entities(MandiPrice.state).distinct().order_by(MandiPrice.state)]
    scoped = base.filter(MandiPrice.state == state) if state else base
    districts = [row[0] for row in scoped.with_entities(MandiPrice.district).distinct().order_by(MandiPrice.district)] if state else []
    scoped = scoped.filter(MandiPrice.district == district) if district else scoped
    commodities = [row[0] for row in scoped.with_entities(MandiPrice.commodity).distinct().order_by(MandiPrice.commodity)]
    return {"states": states, "districts": districts, "commodities": commodities}


@router.get("/history")
def mandi_history(
    state: str,
    market: str,
    commodity: str,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Stored daily prices for one market and commodity (history builds up from daily syncs)."""
    rows = (
        db.query(MandiPrice)
        .filter(MandiPrice.state == state, MandiPrice.market == market, MandiPrice.commodity == commodity)
        .order_by(MandiPrice.arrival_date.asc(), MandiPrice.variety.asc())
        .all()
    )
    return {"unit": "Rs/quintal", "items": [_row(row) for row in rows]}


def _status(db: Session) -> dict:
    last = db.query(MandiSyncRun).order_by(MandiSyncRun.started_at.desc()).first()
    last_ok = (
        db.query(MandiSyncRun)
        .filter(MandiSyncRun.status == "success")
        .order_by(MandiSyncRun.started_at.desc())
        .first()
    )
    latest = _latest_date(db)
    return {
        "mode": mandi_sync.source(),
        "dataset_files": [path.name for path in mandi_sync._dataset_files()] if mandi_sync.source() == "dataset" else [],
        "configured": mandi_sync.configured(),
        "running": mandi_sync.is_running(),
        "source": mandi_sync.source_name(),
        "latest_arrival_date": latest.isoformat() if latest else None,
        "records_latest_date": db.query(func.count(MandiPrice.id)).filter(MandiPrice.arrival_date == latest).scalar() if latest else 0,
        "days_stored": db.query(func.count(func.distinct(MandiPrice.arrival_date))).scalar() or 0,
        "last_success_at": last_ok.finished_at.isoformat() if last_ok and last_ok.finished_at else None,
        "last_run": {
            "status": last.status,
            "started_at": last.started_at.isoformat(),
            "finished_at": last.finished_at.isoformat() if last.finished_at else None,
            "records": last.records,
            "error": last.error,
        } if last else None,
    }


@router.get("/status")
def mandi_status(db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    return _status(db)


@router.post("/sync", status_code=202)
def trigger_sync(
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    _rl=Depends(rate_limit("mandi_sync", 3, 600)),
):
    """Admin: reload prices now from the configured source (runs in the background)."""
    if not mandi_sync.configured():
        detail = ("DATA_GOV_API_KEY is not configured on the server" if mandi_sync.source() == "api"
                  else f"No CSV files found in {mandi_sync.dataset_dir().name}/")
        raise HTTPException(status_code=503, detail=detail)
    if mandi_sync.is_running():
        raise HTTPException(status_code=409, detail="A sync is already running")
    background.add_task(mandi_sync.run_now)
    audit("mandi_sync_requested", request, admin_id=admin.id)
    return {"message": "Sync started", **_status(db)}
