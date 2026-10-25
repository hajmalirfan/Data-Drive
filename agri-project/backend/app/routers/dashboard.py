from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.mandi import MandiPrice
from app.models.operations import (
    Booking,
    CropStock,
    Market,
    MarketPrice,
    Notification,
    Truck,
)
from app.models.user import User
from app.routers.auth import get_current_user
from app.routers.bookings import ACTIVE_STATUSES, booking_out
from app.routers.markets import latest_price_rows, price_out
from app.routers.trucks import truck_out
from app.schemas.operations import CropOut, NotificationOut

router = APIRouter(prefix="/api", tags=["dashboard"])

STOCK_STATUSES = {"available", "reserved", "partially_sold"}


def _revenue_history(bookings: list[Booking], months: int = 6) -> list[dict]:
    now = datetime.utcnow()
    current_month = now.year * 12 + now.month - 1
    month_totals = {}
    for offset in range(months - 1, -1, -1):
        year, month_index = divmod(current_month - offset, 12)
        month_totals[(year, month_index + 1)] = 0.0

    for booking in bookings:
        if (
            booking.status != "delivered"
            or booking.delivered_at is None
            or booking.actual_sold_quantity_kg is None
            or booking.actual_price_per_kg is None
        ):
            continue
        key = (booking.delivered_at.year, booking.delivered_at.month)
        if key in month_totals:
            month_totals[key] += booking.actual_sold_quantity_kg * booking.actual_price_per_kg

    return [
        {"month": f"{year:04d}-{month:02d}", "revenue": round(revenue, 2)}
        for (year, month), revenue in month_totals.items()
    ]


def _user_crops(db: Session, user: User) -> list[CropStock]:
    return (
        db.query(CropStock)
        .filter(CropStock.owner_id == user.id)
        .order_by(CropStock.created_at.desc(), CropStock.id.desc())
        .all()
    )


def _user_bookings(db: Session, user: User) -> list[Booking]:
    query = db.query(Booking)
    if user.role == "admin":
        pass
    elif user.role == "truck_operator":
        query = query.join(Truck).filter(Truck.operator_id == user.id)
    else:
        query = query.filter(Booking.farmer_id == user.id)
    return query.order_by(Booking.created_at.desc(), Booking.id.desc()).all()


def _price_list(db: Session, crop_names: list[str], limit: int = 8):
    pairs = latest_price_rows(db, crop_names or None)
    if not pairs:
        return _government_price_list(db, crop_names, limit)

    market_ids = {price.market_id for price, _ in pairs}
    markets = db.query(Market).filter(Market.id.in_(market_ids)).all() if market_ids else []
    names = {market.id: market.name for market in markets}
    output = []
    for price, previous in pairs:
        output.append(price_out(price, previous, names.get(price.market_id, "")))
        if len(output) >= limit:
            break
    return output


def _government_price_list(db: Session, crop_names: list[str], limit: int):
    latest_date = db.query(func.max(MandiPrice.arrival_date)).scalar()
    if not latest_date:
        return []

    query = db.query(MandiPrice).filter(
        MandiPrice.arrival_date == latest_date,
        MandiPrice.modal_price.is_not(None),
    )
    normalized_crops = [name.strip().lower() for name in crop_names if name.strip()]
    if normalized_crops:
        query = query.filter(
            func.lower(func.trim(MandiPrice.commodity)).in_(normalized_crops)
        )
    prices = query.order_by(MandiPrice.modal_price.desc(), MandiPrice.id.asc()).limit(limit).all()

    if not prices and normalized_crops:
        prices = (
            db.query(MandiPrice)
            .filter(
                MandiPrice.arrival_date == latest_date,
                MandiPrice.modal_price.is_not(None),
            )
            .order_by(MandiPrice.modal_price.desc(), MandiPrice.id.asc())
            .limit(limit)
            .all()
        )

    return [
        {
            "id": f"mandi-{price.id}",
            "crop_name": price.commodity,
            "market_name": f"{price.market} · {price.district}, {price.state}",
            "price_per_kg": round(price.modal_price / 100, 2),
            "trend_pct": None,
            "observed_at": f"{price.arrival_date.isoformat()}T00:00:00+05:30",
            "source": "Agmarknet",
        }
        for price in prices
    ]


def _best_nearby_price(db: Session, crop_names: list[str]):
    pairs = latest_price_rows(db, crop_names or None)
    market_ids = {price.market_id for price, _ in pairs}
    markets = (
        db.query(Market)
        .filter(Market.id.in_(market_ids), Market.distance_km <= 100)
        .all()
        if market_ids
        else []
    )
    market_map = {market.id: market for market in markets}
    candidates = [
        (price, previous, market_map[price.market_id])
        for price, previous in pairs
        if price.market_id in market_map
    ]
    if candidates:
        price, previous, market = max(
            candidates,
            key=lambda item: (item[0].price_per_kg, item[0].observed_at, item[0].id),
        )
        return {
            "crop_name": price.crop_name,
            "market_name": market.name,
            "price_per_kg": price.price_per_kg,
            "observed_at": price.observed_at,
            "is_stale": price_out(price, previous, market.name).is_stale,
        }

    return _best_nearby_government_price(db, crop_names)


def _best_nearby_government_price(db: Session, crop_names: list[str]):
    nearby_markets = db.query(Market).filter(Market.distance_km <= 100).all()
    if not nearby_markets:
        return None

    normalized_crops = [name.strip().lower() for name in crop_names if name.strip()]
    if normalized_crops:
        prices = []
        for crop_name in normalized_crops:
            latest_date = (
                db.query(func.max(MandiPrice.arrival_date))
                .filter(func.lower(func.trim(MandiPrice.commodity)) == crop_name)
                .scalar()
            )
            if latest_date:
                prices.extend(
                    db.query(MandiPrice)
                    .filter(
                        func.lower(func.trim(MandiPrice.commodity)) == crop_name,
                        MandiPrice.arrival_date == latest_date,
                        MandiPrice.modal_price.is_not(None),
                    )
                    .all()
                )
    else:
        latest_date = db.query(func.max(MandiPrice.arrival_date)).scalar()
        prices = (
            db.query(MandiPrice)
            .filter(
                MandiPrice.arrival_date == latest_date,
                MandiPrice.modal_price.is_not(None),
            )
            .all()
            if latest_date
            else []
        )

    def normalize(value: str) -> str:
        return "".join(character for character in value.casefold() if character.isalnum())

    matches = []
    for price in prices:
        market_name = normalize(price.market)
        district = normalize(price.district)
        state = normalize(price.state)
        matching_markets = [
            market
            for market in nearby_markets
            if normalize(market.district) == district
            and normalize(market.state) == state
            and (
                normalize(market.name) == market_name
                or normalize(market.name) in market_name
                or market_name in normalize(market.name)
            )
        ]
        if len(matching_markets) == 1:
            matches.append((price, matching_markets[0]))

    if not matches:
        return None

    price, market = max(
        matches,
        key=lambda item: (item[0].modal_price, item[0].arrival_date, item[0].id),
    )
    return {
        "crop_name": price.commodity,
        "market_name": market.name,
        "price_per_kg": round(price.modal_price / 100, 2),
        "observed_at": price.arrival_date.isoformat(),
        "is_stale": False,
    }


@router.get("/dashboard")
def dashboard(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    crops = _user_crops(db, user)
    bookings = _user_bookings(db, user)
    active_bookings = [booking for booking in bookings if booking.status in ACTIVE_STATUSES]
    markets = db.query(Market).order_by(Market.distance_km.asc()).all()
    markets_out = [
        {
            "id": market.id,
            "name": market.name,
            "district": market.district,
            "state": market.state,
            "latitude": market.latitude,
            "longitude": market.longitude,
            "distance_km": market.distance_km,
            "eta_minutes": market.eta_minutes,
        }
        for market in markets
    ]

    crop_names = sorted({crop.crop_name for crop in crops})
    prices = _price_list(db, crop_names, limit=8)
    best_nearby_price = _best_nearby_price(db, crop_names)
    trucks = (
        db.query(Truck)
        .filter(Truck.status == "available")
        .order_by(Truck.available_capacity_kg.desc())
        .limit(8)
        .all()
    )
    notifications = (
        db.query(Notification)
        .filter(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(10)
        .all()
    )

    total_stock_kg = sum(
        crop.quantity_kg for crop in crops if crop.status in STOCK_STATUSES
    )
    nearby_markets = len([market for market in markets if market.distance_km <= 100])

    return {
        "stats": {
            "total_stock_kg": round(total_stock_kg, 2),
            "crop_count": len(crops),
            "nearby_markets": nearby_markets,
            "available_trucks": db.query(Truck).filter(Truck.status == "available").count(),
            "best_price": best_nearby_price,
            "active_bookings": len(active_bookings),
            "unread_notifications": len([item for item in notifications if not item.is_read]),
        },
        "crops": [CropOut.model_validate(crop) for crop in crops],
        "markets": markets_out,
        "prices": prices,
        "revenue_history": _revenue_history(bookings),
        "trucks": [
            truck_out(truck, user.role == "admin" or truck.operator_id == user.id)
            for truck in trucks
        ],
        "bookings": [booking_out(booking, user) for booking in active_bookings[:5]],
        "notifications": [NotificationOut.model_validate(item) for item in notifications],
    }


@router.get("/reports/summary")
def reports_summary(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    crops = _user_crops(db, user)
    bookings = _user_bookings(db, user)

    by_crop: dict[str, dict] = {}
    for crop in crops:
        entry = by_crop.setdefault(
            crop.crop_name,
            {"crop_name": crop.crop_name, "quantity_kg": 0.0, "listings": 0},
        )
        entry["quantity_kg"] += crop.quantity_kg
        entry["listings"] += 1

    delivered = [booking for booking in bookings if booking.status == "delivered"]
    active = [booking for booking in bookings if booking.status in ACTIVE_STATUSES]
    cancelled = [booking for booking in bookings if booking.status == "cancelled"]
    rejected = [booking for booking in bookings if booking.status == "rejected"]

    actual_revenue = sum(
        (booking.actual_sold_quantity_kg or 0) * (booking.actual_price_per_kg or 0)
        for booking in delivered
    )
    actual_expenses = sum(booking.actual_expenses or 0 for booking in delivered)
    estimated_net = sum(booking.estimated_net_proceeds or 0 for booking in bookings)

    crop_names = sorted({crop.crop_name for crop in crops})
    prices = _price_list(db, crop_names, limit=12)

    return {
        "stock": {
            "total_kg": round(sum(crop.quantity_kg for crop in crops), 2),
            "available_kg": round(
                sum(crop.quantity_kg for crop in crops if crop.status == "available"), 2
            ),
            "listings": len(crops),
            "by_crop": sorted(by_crop.values(), key=lambda item: item["quantity_kg"], reverse=True),
        },
        "bookings": {
            "total": len(bookings),
            "active": len(active),
            "delivered": len(delivered),
            "cancelled": len(cancelled),
            "rejected": len(rejected),
            "estimated_transport_cost": round(
                sum(booking.estimated_transport_cost for booking in bookings), 2
            ),
        },
        "financials": {
            "estimated_net_proceeds": round(estimated_net, 2),
            "actual_revenue": round(actual_revenue, 2),
            "actual_expenses": round(actual_expenses, 2),
            "actual_net": round(actual_revenue - actual_expenses, 2),
        },
        "markets": {
            "count": db.query(Market).count(),
            "price_records": db.query(MarketPrice).count(),
            "stale_prices": sum(bool(getattr(price, "is_stale", False)) for price in prices),
            "prices": prices,
        },
        "recent_bookings": [booking_out(booking, user) for booking in bookings[:5]],
    }


@router.get("/notifications", response_model=list[NotificationOut])
def list_notifications(
    unread_only: bool = Query(default=False),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(Notification).filter(Notification.user_id == user.id)
    if unread_only:
        query = query.filter(Notification.is_read.is_(False))
    return (
        query.order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(limit)
        .all()
    )


@router.patch("/notifications/read-all")
def mark_all_notifications_read(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    db.query(Notification).filter(
        Notification.user_id == user.id,
        Notification.is_read.is_(False),
    ).update({"is_read": True})
    db.commit()
    return {"ok": True}


@router.patch("/notifications/{notification_id}/read", response_model=NotificationOut)
def mark_notification_read(
    notification_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    notification = (
        db.query(Notification)
        .filter(Notification.id == notification_id, Notification.user_id == user.id)
        .first()
    )
    if not notification:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Notification not found")
    notification.is_read = True
    db.commit()
    db.refresh(notification)
    return notification


@router.get("/search")
def search(
    q: str = Query(min_length=1, max_length=120),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    like = f"%{q.strip()}%"
    markets = (
        db.query(Market)
        .filter(Market.name.ilike(like) | Market.district.ilike(like))
        .limit(5)
        .all()
    )
    crops = (
        db.query(CropStock)
        .filter(CropStock.owner_id == user.id, CropStock.crop_name.ilike(like))
        .limit(5)
        .all()
    )
    trucks = (
        db.query(Truck)
        .filter(
            Truck.vehicle_number.ilike(like)
            | Truck.truck_type.ilike(like)
            | Truck.route_from.ilike(like)
            | Truck.route_to.ilike(like)
        )
        .limit(5)
        .all()
    )
    return {
        "markets": [
            {"id": market.id, "label": f"{market.name} · {market.district}", "link": "/markets"}
            for market in markets
        ],
        "crops": [
            {"id": crop.id, "label": f"{crop.crop_name} · {crop.quantity_kg:g} kg", "link": "/crops"}
            for crop in crops
        ],
        "trucks": [
            {"id": truck.id, "label": f"{truck.vehicle_number} · {truck.truck_type}", "link": "/trucks"}
            for truck in trucks
        ],
    }
