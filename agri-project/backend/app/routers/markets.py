from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models.operations import CropStock, Market, MarketPrice
from app.models.user import User
from app.routers.auth import get_current_user, require_price_manager
from app.schemas.operations import (
    ComparisonOut,
    CostBreakdown,
    MarketOption,
    MarketOut,
    PriceCreate,
    PriceOut,
)

router = APIRouter(prefix="/api", tags=["markets"])


def _is_stale(observed_at: datetime | None) -> bool:
    if not observed_at:
        return True
    value = observed_at.replace(tzinfo=None)
    return datetime.utcnow() - value > timedelta(hours=settings.STALE_PRICE_HOURS)


def _trend_pct(current: float, previous: float | None) -> float | None:
    if not previous:
        return None
    return round(((current - previous) / previous) * 100, 1)


def latest_price_rows(
    db: Session, crop_names: list[str] | None = None
) -> list[tuple[MarketPrice, MarketPrice | None]]:
    """Return the latest and previous price for each (market, crop) pair."""
    query = db.query(MarketPrice)
    if crop_names:
        normalized_names = [name.strip().lower() for name in crop_names if name.strip()]
        query = query.filter(func.lower(func.trim(MarketPrice.crop_name)).in_(normalized_names))
    rows = query.order_by(MarketPrice.observed_at.desc(), MarketPrice.id.desc()).all()

    grouped: dict[tuple[int, str], list[MarketPrice]] = {}
    for row in rows:
        key = (row.market_id, row.crop_name.strip().lower())
        grouped.setdefault(key, []).append(row)

    result = []
    for values in grouped.values():
        values.sort(key=lambda item: (item.observed_at, item.id), reverse=True)
        result.append((values[0], values[1] if len(values) > 1 else None))
    result.sort(key=lambda pair: (pair[0].observed_at, pair[0].id), reverse=True)
    return result


def price_out(price: MarketPrice, previous: MarketPrice | None, market_name: str) -> PriceOut:
    return PriceOut(
        id=price.id,
        market_id=price.market_id,
        market_name=market_name,
        crop_name=price.crop_name,
        price_per_kg=price.price_per_kg,
        source=price.source,
        observed_at=price.observed_at,
        trend_pct=_trend_pct(price.price_per_kg, previous.price_per_kg if previous else None),
        is_stale=_is_stale(price.observed_at),
    )


def build_comparison(
    db: Session,
    crop_name: str,
    quantity_kg: float,
    cost_per_kg: float | None = None,
) -> ComparisonOut:
    crop_key = crop_name.strip().lower()
    prices = (
        db.query(MarketPrice)
        .filter(func.lower(func.trim(MarketPrice.crop_name)) == crop_key)
        .order_by(MarketPrice.observed_at.desc(), MarketPrice.id.desc())
        .all()
    )
    latest_by_market: dict[int, MarketPrice] = {}
    for price in prices:
        latest_by_market.setdefault(price.market_id, price)

    markets = (
        db.query(Market)
        .filter(Market.id.in_(latest_by_market.keys()))
        .all()
        if latest_by_market
        else []
    )
    market_map = {market.id: market for market in markets}

    options: list[MarketOption] = []
    for market_id, price in latest_by_market.items():
        market = market_map.get(market_id)
        if not market:
            continue
        loss_pct = settings.MARKET_LOSS_PCT / 100.0
        saleable = quantity_kg * (1 - loss_pct)
        gross = saleable * price.price_per_kg
        transport = market.distance_km * settings.TRANSPORT_RATE_PER_KM + settings.LOADING_COST
        labour = quantity_kg * settings.LABOUR_COST_PER_KG
        commission = gross * (settings.COMMISSION_PCT / 100.0)
        packaging = quantity_kg * settings.PACKAGING_COST_PER_KG
        total_expenses = transport + labour + commission + packaging
        net_proceeds = gross - total_expenses
        estimated_profit = (
            net_proceeds - (cost_per_kg * quantity_kg) if cost_per_kg is not None else None
        )
        options.append(
            MarketOption(
                market_id=market.id,
                market_name=market.name,
                district=market.district,
                distance_km=market.distance_km,
                eta_minutes=market.eta_minutes,
                price_per_kg=price.price_per_kg,
                source=price.source,
                observed_at=price.observed_at,
                is_stale=_is_stale(price.observed_at),
                breakdown=CostBreakdown(
                    saleable_quantity_kg=round(saleable, 2),
                    gross_value=round(gross, 2),
                    transport_cost=round(transport, 2),
                    labour_cost=round(labour, 2),
                    commission=round(commission, 2),
                    packaging_cost=round(packaging, 2),
                    total_expenses=round(total_expenses, 2),
                    net_proceeds=round(net_proceeds, 2),
                    estimated_profit=round(estimated_profit, 2) if estimated_profit is not None else None,
                    loss_pct=settings.MARKET_LOSS_PCT,
                ),
            )
        )

    options.sort(key=lambda option: option.breakdown.net_proceeds, reverse=True)
    recommended = options[0].market_id if options else None
    assumptions = [
        f"Selling loss assumed at {settings.MARKET_LOSS_PCT}% of quantity.",
        f"Transport estimated at ₹{settings.TRANSPORT_RATE_PER_KM}/km plus ₹{settings.LOADING_COST} loading.",
        f"Labour/loading estimated at ₹{settings.LABOUR_COST_PER_KG}/kg.",
        f"Market commission estimated at {settings.COMMISSION_PCT}% of gross value.",
        f"Packaging/handling estimated at ₹{settings.PACKAGING_COST_PER_KG}/kg.",
        f"Prices older than {settings.STALE_PRICE_HOURS} hours are flagged stale.",
    ]

    return ComparisonOut(
        crop_name=crop_name,
        quantity_kg=quantity_kg,
        cost_per_kg=cost_per_kg,
        options=options,
        recommended_market_id=recommended,
        assumptions=assumptions,
    )


@router.get("/markets", response_model=list[MarketOut])
def list_markets(
    q: str | None = Query(default=None, max_length=120),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    query = db.query(Market)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            (Market.name.ilike(like))
            | (Market.district.ilike(like))
            | (Market.state.ilike(like))
        )
    return query.order_by(Market.distance_km.asc(), Market.name.asc()).all()


@router.get("/markets/compare", response_model=ComparisonOut)
def compare_markets(
    crop_name: str | None = Query(default=None, max_length=120),
    quantity_kg: float | None = Query(default=None, gt=0),
    crop_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cost_per_kg = None
    if crop_id is not None:
        crop = db.query(CropStock).filter(CropStock.id == crop_id).first()
        if not crop:
            raise HTTPException(status_code=404, detail="Crop stock not found")
        if user.role != "admin" and crop.owner_id != user.id:
            raise HTTPException(status_code=403, detail="You can only compare your own crop stock")
        crop_name = crop.crop_name
        quantity_kg = quantity_kg or crop.quantity_kg
        cost_per_kg = crop.cost_per_kg

    if not crop_name or not quantity_kg:
        raise HTTPException(
            status_code=400,
            detail="crop_name and quantity_kg are required when crop_id is not provided",
        )
    return build_comparison(db, crop_name, quantity_kg, cost_per_kg)


@router.get("/markets/{market_id}/prices", response_model=list[PriceOut])
def market_price_history(
    market_id: int,
    crop_name: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=30, ge=1, le=200),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    market = db.query(Market).filter(Market.id == market_id).first()
    if not market:
        raise HTTPException(status_code=404, detail="Market not found")
    query = db.query(MarketPrice).filter(MarketPrice.market_id == market_id)
    if crop_name:
        query = query.filter(MarketPrice.crop_name.ilike(crop_name.strip()))
    rows = query.order_by(MarketPrice.observed_at.desc(), MarketPrice.id.desc()).limit(limit).all()
    return [price_out(row, None, market.name) for row in rows]


@router.get("/markets/{market_id}", response_model=MarketOut)
def get_market(
    market_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    market = db.query(Market).filter(Market.id == market_id).first()
    if not market:
        raise HTTPException(status_code=404, detail="Market not found")
    return market


@router.get("/prices", response_model=list[PriceOut])
def list_prices(
    crop_name: str | None = Query(default=None, max_length=120),
    market_id: int | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    crop_names = [crop_name.strip()] if crop_name else None
    pairs = latest_price_rows(db, crop_names)
    market_ids = {price.market_id for price, _ in pairs}
    markets = db.query(Market).filter(Market.id.in_(market_ids)).all() if market_ids else []
    names = {market.id: market.name for market in markets}

    output = []
    for price, previous in pairs:
        if market_id is not None and price.market_id != market_id:
            continue
        output.append(price_out(price, previous, names.get(price.market_id, "")))
    return output[:limit]


@router.get("/prices/crops", response_model=list[str])
def list_price_crops(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    rows = db.query(MarketPrice.crop_name).distinct().order_by(MarketPrice.crop_name.asc()).all()
    return [row[0] for row in rows if row[0]]


@router.post("/prices", response_model=PriceOut, status_code=201)
def create_price(
    data: PriceCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_price_manager),
):
    market = db.query(Market).filter(Market.id == data.market_id).first()
    if not market:
        raise HTTPException(status_code=404, detail="Market not found")

    previous = (
        db.query(MarketPrice)
        .filter(
            MarketPrice.market_id == data.market_id,
            MarketPrice.crop_name.ilike(data.crop_name.strip()),
        )
        .order_by(MarketPrice.observed_at.desc(), MarketPrice.id.desc())
        .first()
    )
    price = MarketPrice(
        market_id=data.market_id,
        crop_name=data.crop_name.strip(),
        price_per_kg=data.price_per_kg,
        source=data.source.strip() or "Market price manager",
        observed_at=data.observed_at or datetime.utcnow(),
        created_by=user.id,
    )
    db.add(price)
    db.commit()
    db.refresh(price)
    return price_out(price, previous, market.name)
