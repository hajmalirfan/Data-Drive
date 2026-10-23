from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
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
from app.routers.markets import build_comparison, latest_price_rows, price_out
from app.routers.trucks import truck_out
from app.schemas.operations import CropOut, NotificationOut

router = APIRouter(prefix="/api", tags=["dashboard"])

STOCK_STATUSES = {"available", "reserved", "partially_sold"}


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
    market_ids = {price.market_id for price, _ in pairs}
    markets = db.query(Market).filter(Market.id.in_(market_ids)).all() if market_ids else []
    names = {market.id: market.name for market in markets}
    output = []
    for price, previous in pairs:
        output.append(price_out(price, previous, names.get(price.market_id, "")))
        if len(output) >= limit:
            break
    return output


@router.get("/dashboard")
def dashboard(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    crops = _user_crops(db, user)
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
    trucks = (
        db.query(Truck)
        .filter(Truck.status == "available")
        .order_by(Truck.available_capacity_kg.desc())
        .limit(8)
        .all()
    )
    bookings = _user_bookings(db, user)
    active_bookings = [booking for booking in bookings if booking.status in ACTIVE_STATUSES]
    notifications = (
        db.query(Notification)
        .filter(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(10)
        .all()
    )

    top_crop = max(crops, key=lambda crop: crop.quantity_kg, default=None)
    comparison = None
    estimated_profit = None
    best_market = None
    if top_crop:
        comparison = build_comparison(db, top_crop.crop_name, top_crop.quantity_kg, top_crop.cost_per_kg)
        if comparison.options:
            best = comparison.options[0]
            best_market = best.market_name
            estimated_profit = (
                best.breakdown.estimated_profit
                if best.breakdown.estimated_profit is not None
                else best.breakdown.net_proceeds
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
            "estimated_profit": round(estimated_profit, 2) if estimated_profit is not None else None,
            "profit_crop": top_crop.crop_name if top_crop else None,
            "profit_quantity_kg": top_crop.quantity_kg if top_crop else None,
            "best_market": best_market,
            "active_bookings": len(active_bookings),
            "unread_notifications": len([item for item in notifications if not item.is_read]),
        },
        "crops": [CropOut.model_validate(crop) for crop in crops],
        "markets": markets_out,
        "comparison": comparison,
        "prices": prices,
        "trucks": [
            truck_out(truck, user.role == "admin" or truck.operator_id == user.id)
            for truck in trucks
        ],
        "bookings": [booking_out(booking, user) for booking in active_bookings[:5]],
        "notifications": [NotificationOut.model_validate(item) for item in notifications],
        "assumptions": comparison.assumptions if comparison else [],
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
            "stale_prices": len([price for price in prices if price.is_stale]),
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
