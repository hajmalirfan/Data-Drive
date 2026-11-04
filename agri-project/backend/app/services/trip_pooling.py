"""Shared truck trips: fare split and trip rules. No FastAPI imports, so it is testable on its own."""
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.operations import Booking, Notification
from app.models.pooling import SharedTrip, SharedTripMember

# Booking statuses that still take space on the truck (also used by routers/bookings.py).
ACTIVE_STATUSES = {"requested", "accepted", "assigned", "picked_up", "in_transit"}
# Once any member booking reaches one of these, the trip has started and shares freeze.
STARTED_STATUSES = {"picked_up", "in_transit", "delivered"}


def trip_fare_for(truck, market) -> float:
    """The one-trip fare for a truck to a market (the formula bookings have always used)."""
    return round(truck.base_fare + market.distance_km * truck.price_per_km, 2)


def split_fare(fare: float, loads: dict[int, float]) -> dict[int, float]:
    """Split `fare` by kg: {booking_id: kg} -> {booking_id: share}, summing exactly to `fare`."""
    if not loads:
        return {}
    if any(kg <= 0 for kg in loads.values()):
        raise ValueError("Every load must be more than 0 kg")
    total = sum(loads.values())
    shares = {booking_id: round(fare * kg / total, 2) for booking_id, kg in loads.items()}
    # Rounding leftover goes to the largest load (lowest id on a tie).
    largest = min(loads, key=lambda booking_id: (-loads[booking_id], booking_id))
    shares[largest] = round(shares[largest] + round(fare - sum(shares.values()), 2), 2)
    return shares


def utc_naive(value: datetime) -> datetime:
    """Naive UTC, the form the booking code compares against datetime.utcnow()."""
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def active_members(trip: SharedTrip) -> list[Booking]:
    return [member.booking for member in trip.members if member.booking.status in ACTIVE_STATUSES]


def is_started(trip: SharedTrip) -> bool:
    return any(member.booking.status in STARTED_STATUSES for member in trip.members)


def space_left_kg(trip: SharedTrip) -> float:
    # Accepted bookings are already taken off the truck; requested ones still need room.
    requested = sum(member.booking.quantity_kg for member in trip.members if member.booking.status == "requested")
    return max(0.0, round(trip.truck.available_capacity_kg - requested, 2))


def is_joinable(trip: SharedTrip, now: datetime) -> str | None:
    """Why a trip takes no new members (closed, started, past_pickup, full, truck_unavailable), or None."""
    if trip.status != "open":
        return "closed"
    if is_started(trip):
        return "started"
    if utc_naive(trip.pickup_at) <= now:
        return "past_pickup"
    if space_left_kg(trip) <= 0:
        return "full"
    if trip.truck.status != "available":
        return "truck_unavailable"
    return None


def close_trip(trip: SharedTrip) -> None:
    if trip.status == "open":
        trip.status = "closed"
        trip.closed_at = datetime.utcnow()


def trip_for_booking(booking: Booking) -> SharedTrip | None:
    return booking.trip_membership.trip if booking.trip_membership else None


def first_name(user) -> str:
    name = (user.full_name or "").strip()
    return name.split()[0] if name else user.email.split("@")[0]


def recalculate(db: Session, trip: SharedTrip, quiet_booking_id: int | None = None) -> None:
    """Re-split the fare over active members and tell each member whose share changed."""
    if is_started(trip):
        return  # Shares freeze once the truck has picked up.
    members = active_members(trip)
    if not members:
        close_trip(trip)
        return
    _resplit(db, trip, members, quiet_booking_id)


def final_split(db: Session, trip: SharedTrip) -> None:
    """At the first pickup: one last split over members on the truck, then shares freeze.

    The truck is now on its trip, so a booking still `requested` can never be accepted
    and drops out of the split.
    """
    members = [booking for booking in active_members(trip) if booking.status != "requested"]
    if members:
        _resplit(db, trip, members, None)


def remove_user(db: Session, user_id: int) -> None:
    """Before an account is deleted: take its bookings off their trips and re-split the rest."""
    memberships = (
        db.query(SharedTripMember)
        .join(Booking, SharedTripMember.booking_id == Booking.id)
        .filter(Booking.farmer_id == user_id)
        .all()
    )
    trips = {member.trip for member in memberships}
    for member in memberships:
        member.trip.members.remove(member)
    db.query(SharedTrip).filter(SharedTrip.opener_id == user_id).update(
        {SharedTrip.opener_id: None}, synchronize_session="fetch"
    )
    for trip in trips:
        recalculate(db, trip)
    db.flush()


def _resplit(db: Session, trip: SharedTrip, members: list[Booking], quiet_booking_id: int | None) -> None:
    shares = split_fare(trip.trip_fare, {booking.id: booking.quantity_kg for booking in members})
    for booking in members:
        old, new = booking.estimated_transport_cost, shares[booking.id]
        if old == new:
            continue
        booking.estimated_transport_cost = new
        if booking.id != quiet_booking_id:
            db.add(Notification(
                user_id=booking.farmer_id,
                title="Shared trip share updated",
                message=(
                    f"Your transport share for the trip to {trip.market.name} is now "
                    f"Rs {new:,.0f} (was Rs {old:,.0f})."
                ),
                link="/shared-trips",
            ))
