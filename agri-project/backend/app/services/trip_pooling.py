"""Shared truck trips: fare split and trip rules. No FastAPI imports, so it is testable on its own."""

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
