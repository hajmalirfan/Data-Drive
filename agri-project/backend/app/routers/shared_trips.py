"""Shared truck trips: farmers going to the same market share one truck and split its fare by kg."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.operations import Booking
from app.models.pooling import SharedTrip, SharedTripMember
from app.models.user import User
from app.routers.auth import get_current_user, require_farmer
from app.routers.bookings import _create_booking, booking_out
from app.schemas.operations import BookingCreate, BookingOut
from app.schemas.pooling import (
    SharedTripDetail,
    SharedTripJoin,
    SharedTripMemberOut,
    SharedTripOpen,
    SharedTripOpened,
    SharedTripQuote,
    SharedTripSummary,
)
from app.services import trip_pooling as pooling

router = APIRouter(prefix="/api/shared-trips", tags=["shared-trips"])

NOT_JOINABLE = {
    "closed": "This trip is closed to new members",
    "started": "This trip has already started",
    "past_pickup": "The pickup time for this trip has passed",
    "full": "This trip has no space left",
    "truck_unavailable": "This truck is not available",
}


def _is_member(trip: SharedTrip, user: User) -> bool:
    return any(booking.farmer_id == user.id for booking in pooling.active_members(trip))


def _summary_fields(trip: SharedTrip, user: User) -> dict:
    active = pooling.active_members(trip)
    return dict(
        id=trip.id,
        market_id=trip.market_id,
        market_name=trip.market.name if trip.market else "",
        pickup_point=trip.pickup_point,
        pickup_at=trip.pickup_at,
        truck_type=trip.truck.truck_type,
        capacity_kg=trip.truck.capacity_kg,
        kg_booked=round(sum(booking.quantity_kg for booking in active), 2),
        kg_free=pooling.space_left_kg(trip),
        member_count=len(active),
        trip_fare=trip.trip_fare,
        status=trip.status,
        is_member=_is_member(trip, user),
    )


def _detail(trip: SharedTrip, user: User) -> SharedTripDetail:
    return SharedTripDetail(
        **_summary_fields(trip, user),
        opener_id=trip.opener_id,
        members=[
            SharedTripMemberOut(
                booking_id=member.booking.id,
                first_name=pooling.first_name(member.booking.farmer),
                quantity_kg=member.booking.quantity_kg,
                status=member.booking.status,
                share=member.booking.estimated_transport_cost,
            )
            for member in trip.members
        ],
    )


def _get_trip(db: Session, trip_id: int) -> SharedTrip:
    trip = db.get(SharedTrip, trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Shared trip not found")
    return trip


def _check_can_join(trip: SharedTrip, user: User, quantity_kg: float) -> None:
    if _is_member(trip, user):
        raise HTTPException(status_code=409, detail="You are already on this trip")
    reason = pooling.is_joinable(trip, datetime.utcnow())
    if reason:
        raise HTTPException(status_code=409, detail=NOT_JOINABLE[reason])
    free = pooling.space_left_kg(trip)
    if quantity_kg > free:
        raise HTTPException(status_code=400, detail=f"Only {free:g} kg is free on this trip")


@router.get("", response_model=list[SharedTripSummary])
def list_trips(
    market_id: int | None = Query(default=None),
    mine: bool = Query(default=False),
    db: Session = Depends(get_db),
    user: User = Depends(require_farmer),
):
    if mine:
        trips = (
            db.query(SharedTrip)
            .join(SharedTripMember)
            .join(Booking, Booking.id == SharedTripMember.booking_id)
            .filter(Booking.farmer_id == user.id)
            .distinct()
            .order_by(SharedTrip.created_at.desc(), SharedTrip.id.desc())
            .all()
        )
        return [SharedTripSummary(**_summary_fields(trip, user)) for trip in trips]

    query = db.query(SharedTrip).filter(SharedTrip.status == "open")
    if market_id is not None:
        query = query.filter(SharedTrip.market_id == market_id)
    now = datetime.utcnow()
    return [
        SharedTripSummary(**_summary_fields(trip, user))
        for trip in query.order_by(SharedTrip.pickup_at, SharedTrip.id).all()
        if pooling.is_joinable(trip, now) is None
    ]


@router.get("/{trip_id}/quote", response_model=SharedTripQuote)
def quote(
    trip_id: int,
    quantity_kg: float = Query(gt=0),
    db: Session = Depends(get_db),
    user: User = Depends(require_farmer),
):
    trip = _get_trip(db, trip_id)
    _check_can_join(trip, user, quantity_kg)
    loads = {booking.id: booking.quantity_kg for booking in pooling.active_members(trip)}
    share = pooling.split_fare(trip.trip_fare, {**loads, 0: quantity_kg})[0]
    return SharedTripQuote(share=share, alone=trip.trip_fare, saving=round(trip.trip_fare - share, 2))


@router.post("", response_model=SharedTripOpened, status_code=201)
def open_trip(
    data: SharedTripOpen,
    db: Session = Depends(get_db),
    user: User = Depends(require_farmer),
):
    pickup_point = data.pickup_point.strip()
    fields = data.model_dump(exclude={"pickup_point"})
    # The truck makes one stop: the shared pickup point. Times are stored as naive UTC.
    fields.update(pickup_location=pickup_point, pickup_at=pooling.utc_naive(data.pickup_at))
    booking = _create_booking(db, user, BookingCreate(**fields))
    trip = SharedTrip(
        truck_id=booking.truck_id,
        market_id=booking.market_id,
        opener_id=user.id,
        pickup_point=pickup_point,
        pickup_at=booking.pickup_at,
        trip_fare=pooling.trip_fare_for(booking.truck, booking.market),
        status="open",
    )
    trip.members.append(SharedTripMember(booking=booking))
    db.add(trip)
    db.commit()
    db.refresh(trip)
    db.refresh(booking)
    return SharedTripOpened(trip=_detail(trip, user), booking=booking_out(booking, user))


@router.post("/{trip_id}/join", response_model=BookingOut, status_code=201)
def join_trip(
    trip_id: int,
    data: SharedTripJoin,
    db: Session = Depends(get_db),
    user: User = Depends(require_farmer),
):
    trip = _get_trip(db, trip_id)
    _check_can_join(trip, user, data.quantity_kg)
    booking = _create_booking(db, user, BookingCreate(
        truck_id=trip.truck_id,
        crop_id=data.crop_id,
        market_id=trip.market_id,
        quantity_kg=data.quantity_kg,
        pickup_location=trip.pickup_point,
        destination=trip.market.name,
        pickup_at=trip.pickup_at,
        notes=data.notes,
    ))
    trip.members.append(SharedTripMember(booking=booking))
    db.flush()
    pooling.recalculate(db, trip, quiet_booking_id=booking.id)
    db.commit()
    db.refresh(booking)
    return booking_out(booking, user)


@router.post("/{trip_id}/close", response_model=SharedTripDetail)
def close(
    trip_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_farmer),
):
    trip = _get_trip(db, trip_id)
    if trip.opener_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="Only the farmer who opened this trip can close it")
    pooling.close_trip(trip)
    db.commit()
    db.refresh(trip)
    return _detail(trip, user)


@router.get("/{trip_id}", response_model=SharedTripDetail)
def detail(
    trip_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    trip = _get_trip(db, trip_id)
    is_member = any(member.booking.farmer_id == user.id for member in trip.members)
    is_operator = trip.truck is not None and trip.truck.operator_id == user.id
    if not (is_member or is_operator or user.role == "admin"):
        raise HTTPException(status_code=403, detail="You cannot view this shared trip")
    return _detail(trip, user)
