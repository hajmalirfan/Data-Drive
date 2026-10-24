from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.operations import Booking, BookingLocationPoint, CropStock, Market, Notification, Truck
from app.models.user import User
from app.routers.auth import get_current_user, require_farmer
from app.routers.markets import build_comparison
from app.schemas.operations import (
    BookingCreate,
    BookingDeliveryUpdate,
    BookingLocationUpdate,
    BookingOut,
    BookingStatusUpdate,
    BookingTrackOut,
    TrackPoint,
)

router = APIRouter(prefix="/api/bookings", tags=["bookings"])

BOOKING_STATUSES = {
    "requested",
    "accepted",
    "rejected",
    "assigned",
    "picked_up",
    "in_transit",
    "delivered",
    "cancelled",
}
ACTIVE_STATUSES = {"requested", "accepted", "assigned", "picked_up", "in_transit"}
TERMINAL_STATUSES = {"rejected", "delivered", "cancelled"}

ALLOWED_TRANSITIONS = {
    "requested": {"accepted", "rejected", "cancelled"},
    "accepted": {"assigned", "picked_up", "in_transit", "cancelled"},
    "assigned": {"picked_up", "in_transit", "cancelled"},
    "picked_up": {"in_transit"},
    "in_transit": {"delivered"},
    "delivered": set(),
    "rejected": set(),
    "cancelled": set(),
}

OPERATOR_STATUSES = {"accepted", "rejected", "assigned", "picked_up", "in_transit", "delivered"}
FARMER_STATUSES = {"cancelled"}

# The operator's app sends a GPS fix every LIVE_SHARE_SECONDS while sharing.
LIVE_SHARE_SECONDS = 15
# Keep the newest fixes only: 960 x 15 s is about 4 hours of trail.
MAX_TRACK_POINTS = 960


def _clear_trail(db: Session, booking: Booking):
    db.query(BookingLocationPoint).filter(BookingLocationPoint.booking_id == booking.id).delete(
        synchronize_session=False
    )


def booking_out(booking: Booking, user: User) -> BookingOut:
    operator = booking.truck.operator if booking.truck else None
    can_view_location = (
        booking.location_consent
        and booking.status in {"picked_up", "in_transit"}
        and (
            user.role == "admin"
            or booking.farmer_id == user.id
            or (booking.truck and booking.truck.operator_id == user.id)
        )
    )
    return BookingOut(
        id=booking.id,
        farmer_id=booking.farmer_id,
        farmer_name=booking.farmer.full_name if booking.farmer else "",
        truck_id=booking.truck_id,
        vehicle_number=booking.truck.vehicle_number if booking.truck else "",
        truck_type=booking.truck.truck_type if booking.truck else "",
        operator_id=operator.id if operator else None,
        operator_name=operator.full_name if operator else "",
        operator_phone=(operator.phone or "") if operator else "",
        operator_location=(operator.location or "") if operator else "",
        crop_id=booking.crop_id,
        crop_name=booking.crop.crop_name if booking.crop else "",
        market_id=booking.market_id,
        market_name=booking.market.name if booking.market else "",
        quantity_kg=booking.quantity_kg,
        pickup_location=booking.pickup_location,
        destination=booking.destination,
        pickup_at=booking.pickup_at,
        accompanied=booking.accompanied,
        status=booking.status,
        distance_km=booking.distance_km,
        eta_minutes=booking.eta_minutes,
        estimated_transport_cost=booking.estimated_transport_cost,
        estimated_net_proceeds=booking.estimated_net_proceeds,
        notes=booking.notes,
        actual_sold_quantity_kg=booking.actual_sold_quantity_kg,
        actual_price_per_kg=booking.actual_price_per_kg,
        actual_expenses=booking.actual_expenses,
        delivered_at=booking.delivered_at,
        location_consent=can_view_location,
        last_lat=booking.last_lat if can_view_location else None,
        last_lng=booking.last_lng if can_view_location else None,
        last_reported_at=booking.last_reported_at if can_view_location else None,
        created_at=booking.created_at,
    )


def _notify(db: Session, user_id: int | None, title: str, message: str, link: str = ""):
    if not user_id:
        return
    db.add(
        Notification(
            user_id=user_id,
            title=title,
            message=message,
            link=link,
        )
    )


def _get_booking(db: Session, booking_id: int, user: User) -> Booking:
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    is_owner = booking.farmer_id == user.id
    is_operator = booking.truck and booking.truck.operator_id == user.id
    if user.role != "admin" and not is_owner and not is_operator:
        raise HTTPException(status_code=403, detail="You cannot access this booking")
    return booking


def _restore_truck_capacity(truck: Truck, quantity: float):
    truck.available_capacity_kg = min(truck.capacity_kg, truck.available_capacity_kg + quantity)
    if truck.status in {"reserved", "on_trip"} and truck.available_capacity_kg > 0:
        truck.status = "available"


@router.get("", response_model=list[BookingOut])
def list_bookings(
    status_filter: str | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(Booking)
    if user.role == "admin":
        pass
    elif user.role == "truck_operator":
        query = query.join(Truck).filter(Truck.operator_id == user.id)
    else:
        query = query.filter(Booking.farmer_id == user.id)
    if status_filter:
        query = query.filter(Booking.status == status_filter)
    return [
        booking_out(booking, user)
        for booking in query.order_by(Booking.created_at.desc(), Booking.id.desc()).all()
    ]


@router.get("/{booking_id}", response_model=BookingOut)
def get_booking(
    booking_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return booking_out(_get_booking(db, booking_id, user), user)


@router.post("", response_model=BookingOut, status_code=201)
def create_booking(
    data: BookingCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_farmer),
):
    truck = db.query(Truck).filter(Truck.id == data.truck_id).first()
    if not truck:
        raise HTTPException(status_code=404, detail="Truck not found")
    if truck.status != "available":
        raise HTTPException(status_code=409, detail="This truck is not available")
    if data.quantity_kg > truck.available_capacity_kg:
        raise HTTPException(
            status_code=400,
            detail=f"Quantity exceeds available capacity ({truck.available_capacity_kg:g} kg)",
        )
    if data.accompanied and not truck.has_passenger_seat:
        raise HTTPException(
            status_code=400,
            detail="This truck does not have a permitted passenger seat",
        )

    market = db.query(Market).filter(Market.id == data.market_id).first()
    if not market:
        raise HTTPException(status_code=404, detail="Market not found")

    crop = None
    if data.crop_id is not None:
        crop = db.query(CropStock).filter(CropStock.id == data.crop_id).first()
        if not crop:
            raise HTTPException(status_code=404, detail="Crop stock not found")
        if user.role != "admin" and crop.owner_id != user.id:
            raise HTTPException(status_code=403, detail="You can only book using your own crop stock")
        if data.quantity_kg > crop.quantity_kg:
            raise HTTPException(
                status_code=400,
                detail="Booking quantity is greater than the available crop stock",
            )

    distance = market.distance_km
    eta = market.eta_minutes
    transport_cost = truck.base_fare + distance * truck.price_per_km

    estimated_net = None
    if crop:
        comparison = build_comparison(db, crop.crop_name, data.quantity_kg, crop.cost_per_kg)
        option = next(
            (item for item in comparison.options if item.market_id == market.id),
            None,
        )
        if option:
            estimated_net = option.breakdown.net_proceeds

    booking = Booking(
        farmer_id=user.id,
        truck_id=truck.id,
        crop_id=crop.id if crop else None,
        market_id=market.id,
        quantity_kg=data.quantity_kg,
        pickup_location=data.pickup_location.strip(),
        destination=data.destination.strip() or market.name,
        pickup_at=data.pickup_at,
        accompanied=data.accompanied,
        status="requested",
        distance_km=distance,
        eta_minutes=eta,
        estimated_transport_cost=round(transport_cost, 2),
        estimated_net_proceeds=round(estimated_net, 2) if estimated_net is not None else None,
        notes=data.notes.strip(),
    )
    db.add(booking)
    db.flush()
    _notify(
        db,
        truck.operator_id,
        "New truck booking request",
        f"{user.full_name or user.email} requested {truck.vehicle_number} for {booking.quantity_kg:g} kg to {market.name}.",
        "/bookings",
    )
    _notify(
        db,
        user.id,
        "Booking request sent",
        f"Your request for {truck.vehicle_number} to {market.name} is pending operator confirmation.",
        "/bookings",
    )
    db.commit()
    db.refresh(booking)
    return booking_out(booking, user)


@router.patch("/{booking_id}/status", response_model=BookingOut)
def update_booking_status(
    booking_id: int,
    data: BookingStatusUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    booking = _get_booking(db, booking_id, user)
    new_status = data.status.strip().lower()
    if new_status not in BOOKING_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid booking status")

    previous = booking.status
    if new_status not in ALLOWED_TRANSITIONS.get(previous, set()):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot change booking status from {previous} to {new_status}",
        )

    is_operator = (
        booking.truck and booking.truck.operator_id == user.id
    ) or user.role == "admin"
    is_farmer = booking.farmer_id == user.id and not is_operator
    if is_farmer and new_status not in FARMER_STATUSES:
        raise HTTPException(status_code=403, detail="Farmers can only cancel bookings")
    if not is_farmer and not is_operator:
        raise HTTPException(status_code=403, detail="You cannot update this booking")

    truck = booking.truck
    if new_status == "accepted":
        if truck.status not in {"available"}:
            raise HTTPException(status_code=409, detail="Truck is no longer available")
        if booking.quantity_kg > truck.available_capacity_kg:
            raise HTTPException(status_code=409, detail="Truck capacity is no longer available")
        truck.available_capacity_kg -= booking.quantity_kg
        if truck.available_capacity_kg <= 0:
            truck.status = "reserved"
    elif new_status in {"picked_up", "in_transit"} and truck and truck.status != "inactive":
        truck.status = "on_trip"
    elif new_status == "delivered":
        booking.delivered_at = datetime.utcnow()
        booking.location_consent = False
        booking.last_lat = None
        booking.last_lng = None
        booking.last_reported_at = None
        _clear_trail(db, booking)
        if truck:
            _restore_truck_capacity(truck, booking.quantity_kg)
    elif new_status in {"rejected", "cancelled"} and previous in {
        "accepted",
        "assigned",
        "picked_up",
        "in_transit",
    }:
        if truck:
            _restore_truck_capacity(truck, booking.quantity_kg)

    booking.status = new_status
    booking.updated_at = datetime.utcnow()

    note = f" {data.note.strip()}" if data.note.strip() else ""
    operator_user_id = truck.operator_id if truck else None
    if is_farmer:
        _notify(
            db,
            operator_user_id,
            "Booking cancelled",
            f"{user.full_name or user.email} cancelled booking #{booking.id}.{note}",
            "/bookings",
        )
        _notify(
            db,
            user.id,
            "Booking cancelled",
            f"Booking #{booking.id} has been cancelled.{note}",
            "/bookings",
        )
    else:
        _notify(
            db,
            booking.farmer_id,
            f"Booking {new_status.replace('_', ' ')}",
            f"Booking #{booking.id} is now {new_status.replace('_', ' ')}.{note}",
            "/tracking" if new_status in {"picked_up", "in_transit"} else "/bookings",
        )

    db.commit()
    db.refresh(booking)
    return booking_out(booking, user)


@router.patch("/{booking_id}/delivery", response_model=BookingOut)
def record_delivery(
    booking_id: int,
    data: BookingDeliveryUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    booking = _get_booking(db, booking_id, user)
    if booking.farmer_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="Only the booking owner can record delivery details")
    if booking.status != "delivered":
        raise HTTPException(status_code=400, detail="Delivery details can only be recorded after delivery")

    booking.actual_sold_quantity_kg = data.actual_sold_quantity_kg
    booking.actual_price_per_kg = data.actual_price_per_kg
    booking.actual_expenses = data.actual_expenses
    booking.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(booking)
    return booking_out(booking, user)


@router.patch("/{booking_id}/location", response_model=BookingOut)
def update_location(
    booking_id: int,
    data: BookingLocationUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    booking = _get_booking(db, booking_id, user)
    if user.role != "admin" and (not booking.truck or booking.truck.operator_id != user.id):
        raise HTTPException(status_code=403, detail="Only the truck operator can share trip location")
    if booking.status not in ACTIVE_STATUSES:
        raise HTTPException(status_code=400, detail="Trip is not active")

    if data.consent and booking.status not in {"picked_up", "in_transit"}:
        raise HTTPException(
            status_code=400,
            detail="Location sharing is available after the trip has started",
        )
    if data.consent and (data.lat is None or data.lng is None):
        raise HTTPException(
            status_code=400,
            detail="Latitude and longitude are required to share location",
        )

    booking.location_consent = data.consent
    if data.consent:
        now = datetime.utcnow()
        booking.last_lat = data.lat
        booking.last_lng = data.lng
        booking.last_reported_at = now
        db.add(BookingLocationPoint(
            booking_id=booking.id, lat=data.lat, lng=data.lng, accuracy_m=data.accuracy_m, recorded_at=now,
        ))
        db.flush()
        stale = (
            db.query(BookingLocationPoint.id)
            .filter(BookingLocationPoint.booking_id == booking.id)
            .order_by(BookingLocationPoint.recorded_at.desc(), BookingLocationPoint.id.desc())
            .offset(MAX_TRACK_POINTS)
            .all()
        )
        if stale:
            db.query(BookingLocationPoint).filter(
                BookingLocationPoint.id.in_([row.id for row in stale])
            ).delete(synchronize_session=False)
    else:
        # Sharing stopped: the farmer no longer sees the truck or its trail.
        booking.last_lat = None
        booking.last_lng = None
        booking.last_reported_at = None
        _clear_trail(db, booking)
    db.commit()
    db.refresh(booking)
    return booking_out(booking, user)


@router.get("/{booking_id}/track", response_model=BookingTrackOut)
def booking_track(
    booking_id: int,
    since: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Live trail for the farmer's map: every fix since `since` (or the whole trail)."""
    booking = _get_booking(db, booking_id, user)
    sharing = bool(booking.location_consent and booking.status in {"picked_up", "in_transit"})
    points = []
    if sharing:
        query = db.query(BookingLocationPoint).filter(BookingLocationPoint.booking_id == booking.id)
        if since is not None:
            if since.tzinfo is not None:
                since = since.astimezone(timezone.utc).replace(tzinfo=None)
            query = query.filter(BookingLocationPoint.recorded_at > since)
        points = [
            TrackPoint(lat=row.lat, lng=row.lng, recorded_at=row.recorded_at)
            for row in query.order_by(BookingLocationPoint.recorded_at, BookingLocationPoint.id).all()
        ]
    return BookingTrackOut(
        booking_id=booking.id,
        status=booking.status,
        sharing=sharing,
        interval_seconds=LIVE_SHARE_SECONDS,
        last_reported_at=booking.last_reported_at if sharing else None,
        points=points,
    )
