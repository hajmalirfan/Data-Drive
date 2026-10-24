"""Market finder: where should a farmer sell, after real transport and market costs?

Prices: government mandi prices (latest date). Locations: OpenStreetMap.
Road distance/time: OSRM. Transport: cheapest truck listed in the app that can
carry the load (same formula as bookings), else the configured standard rate.
"""
from concurrent.futures import ThreadPoolExecutor, wait
from types import SimpleNamespace

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core import geo
from app.core.config import settings
from app.core.database import SessionLocal, get_db
from app.core.security_policy import rate_limit
from app.models.mandi import MandiPrice
from app.models.operations import CropStock, Truck
from app.models.user import User
from app.routers.auth import get_current_user

router = APIRouter(prefix="/api/market-finder", tags=["market finder"])

SHORTLIST_NEAREST = 20
SHORTLIST_PRICIEST = 12
ROUTE_WORKERS = 4
ROUTE_BUDGET_SECONDS = 20


def _latest_rows(db: Session, commodity: str):
    latest = (
        db.query(func.max(MandiPrice.arrival_date))
        .filter(func.lower(MandiPrice.commodity) == commodity.lower())
        .scalar()
    )
    if not latest:
        return None, []
    rows = (
        db.query(MandiPrice)
        .filter(func.lower(MandiPrice.commodity) == commodity.lower(), MandiPrice.arrival_date == latest)
        .all()
    )
    # Plain values: the session is released before slow route lookups.
    fields = ("state", "district", "market", "commodity", "variety", "grade", "arrival_date",
              "min_price", "max_price", "modal_price")
    return latest, [SimpleNamespace(**{f: getattr(row, f) for f in fields}) for row in rows]


def _resolve_origin(db: Session, user: User, lat, lng, place, crop: CropStock | None):
    if lat is not None and lng is not None:
        if not (6 <= lat <= 38 and 68 <= lng <= 98):
            raise HTTPException(status_code=400, detail="Location must be inside India")
        return {"lat": lat, "lng": lng, "label": place or "Your location", "source": "gps"}
    candidates = [(place, "search")] if place else []
    if crop and crop.pickup_location:
        candidates.append((crop.pickup_location, "crop_pickup"))
    if user.location:
        candidates.append((user.location, "profile"))
    for text, source in candidates:
        hit = geo.geocode(db, f"{text}, India")
        if hit:
            # Short label: the first parts of the OpenStreetMap address.
            label = ", ".join(part.strip() for part in (hit[2] or text).split(",")[:3])
            return {"lat": hit[0], "lng": hit[1], "label": label, "source": source, "query": text}
    raise HTTPException(
        status_code=400,
        detail="We could not find your location. Use 'My location', type your village or town, or tap the map.",
    )


def _transport_rate(db: Session, quantity_kg: float):
    """Cheapest available truck in the app that can carry the load."""
    trucks = (
        db.query(Truck)
        .filter(Truck.status == "available", Truck.available_capacity_kg >= quantity_kg)
        .all()
    )
    if trucks:
        # Compare on a typical 100 km trip so base fare and per-km rate are both counted.
        best = min(trucks, key=lambda t: t.base_fare + 100 * t.price_per_km)
        return {
            "source": "truck",
            "truck_id": best.id,
            "vehicle_number": best.vehicle_number,
            "truck_type": best.truck_type,
            "base_fare": best.base_fare,
            "price_per_km": best.price_per_km,
        }
    return {
        "source": "standard",
        "base_fare": settings.LOADING_COST,
        "price_per_km": settings.TRANSPORT_RATE_PER_KM,
    }


def _costs(quantity_kg: float, price_per_kg: float, road_km: float, rate: dict, cost_per_kg: float | None):
    saleable = quantity_kg * (1 - settings.MARKET_LOSS_PCT / 100.0)
    gross = saleable * price_per_kg
    transport = rate["base_fare"] + road_km * rate["price_per_km"]
    labour = quantity_kg * settings.LABOUR_COST_PER_KG
    commission = gross * settings.COMMISSION_PCT / 100.0
    packaging = quantity_kg * settings.PACKAGING_COST_PER_KG
    expenses = transport + labour + commission + packaging
    net = gross - expenses
    production = cost_per_kg * quantity_kg if cost_per_kg is not None else None
    profit = net - production if production is not None else None
    return {
        "saleable_kg": round(saleable, 1),
        "gross": round(gross, 2),
        "transport": round(transport, 2),
        "labour": round(labour, 2),
        "commission": round(commission, 2),
        "packaging": round(packaging, 2),
        "expenses": round(expenses, 2),
        "net": round(net, 2),
        "net_per_kg": round(net / quantity_kg, 2) if quantity_kg else None,
        "production_cost": round(production, 2) if production is not None else None,
        "profit": round(profit, 2) if profit is not None else None,
        "profit_margin_pct": round(profit / production * 100, 1) if profit is not None and production else None,
    }


@router.get("/commodities")
def finder_commodities(db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    latest = db.query(func.max(MandiPrice.arrival_date)).scalar()
    if not latest:
        return {"arrival_date": None, "commodities": []}
    names = [r[0] for r in db.query(MandiPrice.commodity).filter(MandiPrice.arrival_date == latest).distinct().order_by(MandiPrice.commodity)]
    return {"arrival_date": latest.isoformat(), "commodities": names}


@router.get("")
def find_markets(
    commodity: str = Query(..., min_length=1, max_length=120),
    quantity_kg: float = Query(..., gt=0, le=100000),
    lat: float | None = None,
    lng: float | None = None,
    place: str | None = Query(None, max_length=120),
    crop_id: int | None = None,
    cost_per_kg: float | None = Query(None, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _rl=Depends(rate_limit("market_finder", 30, 60)),
):
    crop = None
    if crop_id is not None:
        crop = db.query(CropStock).filter(CropStock.id == crop_id, CropStock.owner_id == user.id).first()
        if cost_per_kg is None and crop and crop.cost_per_kg is not None:
            cost_per_kg = crop.cost_per_kg

    arrival, rows = _latest_rows(db, commodity)
    if not rows:
        raise HTTPException(status_code=404, detail=f"No government mandi prices for {commodity} yet")
    origin = _resolve_origin(db, user, lat, lng, place, crop)

    # Best published price per market (a market can list several varieties).
    by_market: dict[tuple, MandiPrice] = {}
    for row in rows:
        key = (row.state, row.district, row.market)
        if row.modal_price is not None and (key not in by_market or row.modal_price > by_market[key].modal_price):
            by_market[key] = row

    located, pending = [], []
    places = geo.locate_markets_cached(db, list(by_market))
    for key, row in by_market.items():
        where = places.get(key)
        if where == "pending":
            pending.append(key)
        elif where:
            straight = geo.haversine_km(origin["lat"], origin["lng"], where[0], where[1])
            located.append({"row": row, "lat": where[0], "lng": where[1], "precision": where[2], "straight_km": straight})
    if pending:
        geo.start_locating(pending)

    nearest = sorted(located, key=lambda m: m["straight_km"])[:SHORTLIST_NEAREST]
    priciest = sorted(located, key=lambda m: -(m["row"].modal_price or 0))[:SHORTLIST_PRICIEST]
    shortlist = {id(m): m for m in nearest + priciest}.values()

    shortlist = list(shortlist)
    known_routes = geo.cached_routes(db, origin["lat"], origin["lng"], [(m["lat"], m["lng"]) for m in shortlist])
    rate = _transport_rate(db, quantity_kg)
    # Release the database connection before slow external routing calls.
    db.close()

    def route(m):
        cached = known_routes.get(geo._point_key(m["lat"], m["lng"]))
        if cached:
            return m, cached
        session = SessionLocal()
        try:
            return m, geo.road_route(session, origin["lat"], origin["lng"], m["lat"], m["lng"])
        finally:
            session.close()

    # Routes that miss the time budget keep running in the background and are
    # cached for the next search; they are reported, never guessed.
    pool = ThreadPoolExecutor(max_workers=ROUTE_WORKERS)
    futures = [pool.submit(route, m) for m in shortlist]
    done, not_done = wait(futures, timeout=ROUTE_BUDGET_SECONDS)
    pool.shutdown(wait=False)
    routed = [f.result() for f in done if not f.exception()]

    options = []
    for m, road in routed:
        if not road:
            continue  # no road route found: never guess a distance
        row = m["row"]
        price_per_kg = row.modal_price / 100.0
        options.append({
            "key": f"{row.state}|{row.district}|{row.market}",
            "market": row.market,
            "district": row.district,
            "state": row.state,
            "variety": row.variety,
            "grade": row.grade,
            "arrival_date": row.arrival_date.isoformat(),
            "min_price": row.min_price,
            "max_price": row.max_price,
            "modal_price": row.modal_price,
            "price_per_kg": round(price_per_kg, 2),
            "lat": m["lat"],
            "lng": m["lng"],
            "location_precision": m["precision"],
            "road_km": road[0],
            "drive_minutes": road[1],
            **_costs(quantity_kg, price_per_kg, road[0], rate, cost_per_kg),
        })

    picks = {}
    if options:
        picks = {
            "nearest": min(options, key=lambda o: o["road_km"])["key"],
            "quickest": min(options, key=lambda o: o["drive_minutes"])["key"],
            "best_price": max(options, key=lambda o: o["modal_price"])["key"],
            "best_profit": max(options, key=lambda o: o["net"])["key"],
        }
    options.sort(key=lambda o: -o["net"])

    return {
        "commodity": rows[0].commodity,
        "arrival_date": arrival.isoformat(),
        "quantity_kg": quantity_kg,
        "cost_per_kg": cost_per_kg,
        "origin": origin,
        "transport": rate,
        "assumptions": {
            "market_loss_pct": settings.MARKET_LOSS_PCT,
            "labour_per_kg": settings.LABOUR_COST_PER_KG,
            "commission_pct": settings.COMMISSION_PCT,
            "packaging_per_kg": settings.PACKAGING_COST_PER_KG,
        },
        "markets_with_price": len(by_market),
        "markets_located": len(located),
        "markets_locating": len(pending),
        "routes_pending": len(not_done),
        "options": options,
        "picks": picks,
        # Every located market for the map, including ones outside the routed shortlist.
        "map_markets": [
            {"key": f"{m['row'].state}|{m['row'].district}|{m['row'].market}", "market": m["row"].market,
             "district": m["row"].district, "lat": m["lat"], "lng": m["lng"], "modal_price": m["row"].modal_price,
             "precision": m["precision"]}
            for m in located
        ],
        "sources": {
            "prices": "Government mandi prices (Agmarknet)",
            "locations": "© OpenStreetMap contributors (Nominatim)",
            "routes": "OSRM road routing on OpenStreetMap data",
        },
    }


@router.get("/route")
def finder_route(
    o_lat: float, o_lng: float, d_lat: float, d_lng: float,
    _user: User = Depends(get_current_user),
    _rl=Depends(rate_limit("market_route", 30, 60)),
):
    path = geo.route_geometry(o_lat, o_lng, d_lat, d_lng)
    if not path:
        raise HTTPException(status_code=503, detail="Road route is not available right now")
    return {"path": path}
