"""Guest selling-decision API (PRD v4.2 sections 4-5).

POST /api/auth/guest       short-lived demo token, valid only for the endpoints below
GET  /api/decision/options regions, crops and markets the comparison can offer, plus the data badge
POST /api/decision/compare runs the decision engine on the latest dated price per chosen market

Every rule lives in ``app.services.decision_engine``; this module only loads rows,
validates the request shape and serialises the result. Farmer inputs are not stored.
"""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token, decode_token
from app.core.security_policy import rate_limit
from app.models.decision import DecisionMarket, MarketCrop, PriceRecord, Region, UnitConversion
from app.services import decision_engine as engine

router = APIRouter(tags=["decision"])
guest_scheme = HTTPBearer(auto_error=False)

IST = timezone(timedelta(hours=5, minutes=30))  # India has no daylight saving
GUEST_PURPOSE = "guest"
MAX_MARKETS = 3
SAMPLE_AS_OF = date(2026, 10, 25)  # the PRD demo date the sample seed is dated against

MARKET_TYPE_LABELS = {"wholesale": "Wholesale", "uzhavar_sandhai": "Uzhavar Sandhai", "unknown": "Type unknown"}
REASON_LABELS = {
    engine.STALE: "Stale: older than the freshness limit",
    engine.UNIT_UNCLEAR: "Unit unclear: weight of the unit is not known",
    engine.DIFFERENT_TYPE: "Different market type: not compared with the others",
    engine.DIFFERENT_DATE: "Different report date from the other markets",
    engine.PRICE_INVALID: "Price invalid: modal price is outside its min-max range",
    engine.SOURCE_FAILED: "Source run failed",
    engine.SOURCE_UNKNOWN: "Source unknown",
    engine.DATE_UNKNOWN: "Report date unknown",
    engine.TYPE_UNKNOWN: "Market type unknown",
    engine.DIFFERENT_CROP: "Different crop",
}


# ---- configuration and access ----------------------------------------------
def decision_config() -> dict:
    """Engine config from settings; a dependency so tests can move the as-of date."""
    data_mode = settings.DECISION_DATA_MODE.strip().lower()
    if settings.DECISION_AS_OF:
        as_of = date.fromisoformat(settings.DECISION_AS_OF)
    else:
        as_of = datetime.now(IST).date() if data_mode == "snapshot" else SAMPLE_AS_OF
    return {
        "as_of": as_of,
        "freshness_days": settings.DECISION_FRESHNESS_DAYS,
        "tie_band_floor": Decimal(str(settings.DECISION_TIE_BAND_FLOOR)),
        "tie_band_pct": Decimal(str(settings.DECISION_TIE_BAND_PCT)),
        "data_mode": data_mode,
    }


def require_guest(credentials: HTTPAuthorizationCredentials | None = Depends(guest_scheme)) -> None:
    payload = decode_token(credentials.credentials) if credentials else None
    if not payload or payload.get("purpose") != GUEST_PURPOSE:
        raise HTTPException(status_code=401, detail="Guest session expired. Reload the page.")


@router.post("/api/auth/guest", dependencies=[Depends(rate_limit("guest_token", 300, 3600))])
def guest_token():
    """Demo token. Its 'purpose' claim makes every signed-in endpoint reject it."""
    minutes = settings.GUEST_TOKEN_MINUTES
    token = create_access_token({"sub": GUEST_PURPOSE, "purpose": GUEST_PURPOSE}, timedelta(minutes=minutes))
    return {"access_token": token, "token_type": "bearer", "expires_in": minutes * 60}


# ---- source adapter ---------------------------------------------------------
def short_date(value: date) -> str:
    return f"{value.day} {value.strftime('%b %Y')}"


def wants_sample(config: dict) -> bool:
    return config["data_mode"] != "snapshot"


def data_badge(db: Session, config: dict) -> dict:
    if wants_sample(config):
        return {"mode": "sample", "label": f"Sample data as of {short_date(config['as_of'])}"}
    latest = (
        db.query(PriceRecord)
        .filter(PriceRecord.is_sample.is_(False), PriceRecord.report_date.isnot(None))
        .order_by(PriceRecord.report_date.desc())
        .first()
    )
    if latest is None:
        return {"mode": "snapshot", "label": "No reported prices loaded"}
    return {"mode": "snapshot", "label": f"Reported {short_date(latest.report_date)}, source: {latest.source_name}"}


def unit_table(db: Session) -> dict:
    rows = db.query(UnitConversion).all()
    return {row.unit.lower(): Decimal(row.kg_per_unit) for row in rows} or dict(engine.DEFAULT_CONFIG["unit_kg"])


def enabled_markets(db: Session) -> list[tuple[DecisionMarket, str]]:
    """Configured (market, crop) pairs of enabled markets. A pair with no price rows gives EMPTY."""
    rows = (
        db.query(DecisionMarket, MarketCrop.crop)
        .join(MarketCrop, MarketCrop.market_id == DecisionMarket.id)
        .filter(DecisionMarket.enabled.is_(True))
        .all()
    )
    return [(market, crop.strip().lower()) for market, crop in rows]


def latest_records(db: Session, markets: list[DecisionMarket], crop: str, config: dict) -> list[dict]:
    """One latest record per market for this crop, as plain dicts for the engine."""
    if not markets:
        return []
    by_id = {m.id: m for m in markets}
    rows = (
        db.query(PriceRecord)
        .options(joinedload(PriceRecord.run))
        .filter(PriceRecord.market_id.in_(by_id), PriceRecord.is_sample.is_(wants_sample(config)))
        .all()
    )
    latest = {}
    for row in rows:
        if row.crop.strip().lower() != crop:
            continue
        key = (row.report_date is not None, row.report_date or date.min, -row.id)
        if row.market_id not in latest or key > latest[row.market_id][0]:
            latest[row.market_id] = (key, row)
    records = []
    for _, row in latest.values():
        market = by_id[row.market_id]
        records.append({
            "market_id": market.slug, "market_name": market.name, "market_type": market.market_type,
            "crop": row.crop, "report_date": row.report_date, "min_price": row.min_price,
            "max_price": row.max_price, "modal_price": row.modal_price, "unit": row.unit,
            "source_name": row.source_name, "is_sample": row.is_sample, "run_status": row.run.status,
        })
    return records


# ---- endpoints --------------------------------------------------------------
@router.get("/api/decision/options", dependencies=[Depends(require_guest)])
def options(db: Session = Depends(get_db), config: dict = Depends(decision_config)):
    try:
        pairs = enabled_markets(db)
        regions = {r.id: r for r in db.query(Region).all()}
        badge = data_badge(db, config)
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail=engine.MESSAGES[engine.SOURCE_ERROR])

    grouped: dict[int, dict[str, list]] = {}
    for market, crop in sorted(pairs, key=lambda pair: pair[0].name):
        grouped.setdefault(market.region_id, {}).setdefault(crop, []).append({
            "id": market.slug, "name": market.name, "market_type": market.market_type,
            "market_type_label": MARKET_TYPE_LABELS.get(market.market_type, market.market_type),
        })
    return {
        "data": badge,
        "as_of": config["as_of"].isoformat(),
        "freshness_days": config["freshness_days"],
        "units": ["kg", "quintal", "tonne", "crate"],
        "crate_kg": 14,
        "max_markets": MAX_MARKETS,
        "regions": [
            {
                "id": region_id, "name": regions[region_id].name, "state": regions[region_id].state,
                "crops": [{"crop": crop, "markets": markets} for crop, markets in sorted(crops.items())],
            }
            for region_id, crops in grouped.items() if region_id in regions
        ],
    }


class MarketInput(BaseModel):
    market_id: str
    trip_cost: Decimal | None = None
    no_cost: bool = False
    commission_pct: Decimal | None = None
    commission_flat: Decimal | None = None
    loading: Decimal | None = None
    handling: Decimal | None = None


class CompareRequest(BaseModel):
    region_id: int | None = None
    crop: str
    quantity: Decimal | None = None
    unit: str = "kg"
    vehicle_capacity_kg: Decimal | None = None
    picking_per_crate: Decimal | None = None
    packing_per_crate: Decimal | None = None
    markets: list[MarketInput]


def freshness_text(age: int | None, freshness_days: int) -> str:
    if age is None:
        return "Report date unknown"
    if age < 0:
        return "Dated after the comparison date"
    when = "today" if age == 0 else ("1 day ago" if age == 1 else f"{age} days ago")
    status = "fresh" if age <= freshness_days else "stale"
    return f"Reported {when} ({status})"


def plain(value):
    """JSON-safe copy: Decimal -> float (rounding happens only in the browser), date -> ISO string."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [plain(v) for v in value]
    return value


def assumptions(config: dict) -> list[str]:
    pct = format(config["tie_band_pct"].normalize(), "f")
    return [
        "A reported price is a market benchmark, not a buyer's offer. Verify before travel.",
        "Estimate after the costs you entered. Costs left blank are not included.",
        f"Prices older than {config['freshness_days']} days are not ranked.",
        f"Two markets less than Rs {engine.inr(config['tie_band_floor'])} or {pct}% apart are too close to call.",
        "1 crate = 14 kg. Transport is your trip cost x the trips needed for the vehicle capacity.",
    ]


@router.post(
    "/api/decision/compare",
    dependencies=[Depends(require_guest), Depends(rate_limit("decision_compare", 60, 60))],
)
def compare(body: CompareRequest, db: Session = Depends(get_db), config: dict = Depends(decision_config)):
    crop = body.crop.strip().lower()
    inputs = body.model_dump()
    inputs["crop"] = crop
    errors = {}

    slugs = [m.market_id for m in body.markets]
    if not 2 <= len(slugs) <= MAX_MARKETS:
        errors["markets"] = f"Choose 2 to {MAX_MARKETS} markets."
    elif len(set(slugs)) != len(slugs):
        errors["markets"] = "Choose each market once."

    source_error, records, unit_kg = False, [], None
    try:
        pairs = enabled_markets(db)
        unit_kg = unit_table(db)
        offered = {m.slug: m for m, c in pairs if c == crop and (body.region_id is None or m.region_id == body.region_id)}
        if not any(c == crop for _, c in pairs):
            errors["crop"] = "This crop is not validated yet."
        else:
            for i, slug in enumerate(slugs):
                if slug not in offered:
                    errors[f"markets[{i}].market_id"] = "This market is not available for this crop."
        if not errors:
            records = latest_records(db, [offered[s] for s in slugs], crop, config)
        badge = data_badge(db, config)
    except SQLAlchemyError:
        db.rollback()
        source_error, errors = True, {k: v for k, v in errors.items() if k == "markets"}
        badge = {"mode": "sample" if wants_sample(config) else "snapshot", "label": None}

    engine_config = {
        "as_of": config["as_of"], "freshness_days": config["freshness_days"],
        "tie_band_floor": config["tie_band_floor"], "tie_band_pct": config["tie_band_pct"],
        "sample_label": badge["label"] or engine.DEFAULT_CONFIG["sample_label"],
        **({"unit_kg": unit_kg} if unit_kg else {}),
    }
    errors.update(engine.validate_inputs(inputs, engine.config_with(engine_config)))
    if errors:
        raise HTTPException(status_code=422, detail={"message": "Check the highlighted fields.", "errors": errors})

    result = engine.compare(inputs, records, engine_config, source_error=source_error)
    for card in result["cards"]:
        card["market_type_label"] = MARKET_TYPE_LABELS.get(card["market_type"], card["market_type"] or "Type unknown")
        card["freshness_text"] = freshness_text(card["age_days"], config["freshness_days"])
        card["reason_text"] = REASON_LABELS.get(card["reason"], card["reason"])

    return plain({
        **result,
        "data": badge,
        "as_of": config["as_of"],
        "assumptions": assumptions(config),
    })
