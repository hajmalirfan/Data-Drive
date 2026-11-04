"""Fill a local database with demo data: markets, prices, operators with trucks, farmers with crops,
and one open shared trip that a third farmer can join.

Run from agri-project/backend:  python -m scripts.seed_demo
  --password P          password for every demo account (or set DEMO_PASSWORD); random if omitted
  --allow-non-sqlite    seed a database that is not SQLite (e.g. a Postgres dev database)

Safe to run again: anything that already exists (same email, market name or vehicle number) is
left as it is, and existing passwords are never changed. Prices are made-up demo figures, labelled
as such, not real mandi prices.
"""
import argparse
import os
import secrets
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import Base, SessionLocal, engine
from app.core.security import hash_password
from app.core.security_policy import password_problem
from app.models.operations import CropStock, Market, MarketPrice, Truck
from app.models.pooling import SharedTrip
from app.models.user import User
from app.routers import shared_trips
from app.schemas.pooling import SharedTripJoin, SharedTripOpen

PRICE_SOURCE = "Demo sample (not real prices)"
PICKUP_POINT = "Ayakudi bus stand"

# (name, district, latitude, longitude, distance_km from the demo farmers' area)
MARKETS = (
    ("Palani", "Dindigul", 10.4500, 77.5200, 50),
    ("Oddanchatram", "Dindigul", 10.4880, 77.7500, 35),
    ("Dindigul", "Dindigul", 10.3624, 77.9695, 70),
    ("Madurai Mattuthavani", "Madurai", 9.9450, 78.1560, 130),
)
# Rs per kg at each market, in MARKETS order.
PRICES = {
    "Tomato": (22, 20, 24, 26),
    "Onion": (30, 28, 31, 34),
    "Banana": (24, 22, 25, 27),
}
OPERATORS = (
    ("demo.selvam@example.com", "Selvam Transport", "9000000101"),
    ("demo.kavitha@example.com", "Kavitha Logistics", "9000000102"),
)
# (operator email, vehicle number, type, capacity kg, base fare, Rs per km)
TRUCKS = (
    ("demo.selvam@example.com", "TN 57 DM 1001", "Mini truck", 1000, 500, 26),
    ("demo.selvam@example.com", "TN 57 DM 2002", "Open body", 3000, 900, 32),
    ("demo.kavitha@example.com", "TN 58 DM 3003", "Pickup", 750, 400, 22),
)
# (email, name, phone, crop, kg, cost per kg)
FARMERS = (
    ("demo.arun@example.com", "Arun Kumar", "9000000201", "Tomato", 300, 9),
    ("demo.bala@example.com", "Bala Murugan", "9000000202", "Onion", 600, 14),
    ("demo.chitra@example.com", "Chitra Devi", "9000000203", "Banana", 400, 11),
)


def check_database_url(url: str, allow_other: bool) -> None:
    """Refuse anything but SQLite unless asked, so a shared or deployed database is never seeded by accident."""
    if not url.startswith("sqlite") and not allow_other:
        raise SystemExit(
            "DATABASE_URL is not SQLite. Demo data is meant for a local database; "
            "pass --allow-non-sqlite only if this is a throwaway development database."
        )


def _user(db: Session, email: str, name: str, phone: str, role: str, password_hash: str, log: list) -> User:
    user = db.query(User).filter(User.email == email).first()
    if user:
        log.append(f"kept     {role:15} {email}  (password unchanged)")
        return user
    user = User(email=email, full_name=name, phone=phone, role=role, hashed_password=password_hash,
                location=PICKUP_POINT if role == "farmer" else "")
    db.add(user)
    db.flush()
    log.append(f"created  {role:15} {email}  ({name})")
    return user


def seed_demo(db: Session, password: str) -> list[str]:
    """Add the demo data that is missing and return one line per thing created or kept."""
    problem = password_problem(password)
    if problem:
        raise SystemExit(f"Demo password rejected: {problem}")
    password_hash = hash_password(password)
    log: list[str] = []

    markets = {}
    for name, district, lat, lng, km in MARKETS:
        market = db.query(Market).filter(Market.name == name).first()
        if not market:
            market = Market(name=name, district=district, latitude=lat, longitude=lng, distance_km=km)
            db.add(market)
            db.flush()
            log.append(f"created  market          {name} ({km} km)")
        markets[name] = market
    for crop, values in PRICES.items():
        for (name, *_), price in zip(MARKETS, values):
            market = markets[name]
            exists = db.query(MarketPrice).filter(
                MarketPrice.market_id == market.id, MarketPrice.crop_name == crop,
                MarketPrice.source == PRICE_SOURCE,
            ).first()
            if not exists:
                db.add(MarketPrice(market_id=market.id, crop_name=crop, price_per_kg=price, source=PRICE_SOURCE))

    users = {}
    for email, name, phone in OPERATORS:
        users[email] = _user(db, email, name, phone, "truck_operator", password_hash, log)
    trucks = {}
    for email, number, kind, capacity, base, per_km in TRUCKS:
        truck = db.query(Truck).filter(Truck.vehicle_number == number).first()
        if not truck:
            truck = Truck(
                operator_id=users[email].id, vehicle_number=number, truck_type=kind, capacity_kg=capacity,
                available_capacity_kg=capacity, base_fare=base, price_per_km=per_km, status="available",
                route_from=PICKUP_POINT, route_to="Palani",
            )
            db.add(truck)
            db.flush()
            log.append(f"created  truck           {number} ({kind}, {capacity} kg)")
        trucks[number] = truck

    crops = {}
    for email, name, phone, crop, kg, cost in FARMERS:
        farmer = users[email] = _user(db, email, name, phone, "farmer", password_hash, log)
        stock = db.query(CropStock).filter(CropStock.owner_id == farmer.id, CropStock.crop_name == crop).first()
        if not stock:
            stock = CropStock(owner_id=farmer.id, crop_name=crop, quantity_kg=kg, cost_per_kg=cost,
                              pickup_location=PICKUP_POINT)
            db.add(stock)
            db.flush()
        crops[email] = stock
    db.commit()

    arun, bala = users["demo.arun@example.com"], users["demo.bala@example.com"]
    now = datetime.utcnow()
    live_trip = db.query(SharedTrip).filter(
        SharedTrip.opener_id == arun.id, SharedTrip.status == "open", SharedTrip.pickup_at > now,
    ).first()
    if live_trip:
        log.append(f"kept     shared trip     #{live_trip.id} to {live_trip.market.name}")
        return log

    # Tomorrow 06:00 India time (00:30 UTC), so the trip is still open to join during the demo.
    pickup_at = (now + timedelta(days=1)).replace(hour=0, minute=30, second=0, microsecond=0)
    opened = shared_trips.open_trip(SharedTripOpen(
        truck_id=trucks["TN 57 DM 1001"].id, crop_id=crops[arun.email].id, market_id=markets["Palani"].id,
        quantity_kg=200, pickup_location=PICKUP_POINT, destination="Palani", pickup_at=pickup_at,
        pickup_point=PICKUP_POINT,
    ), db, arun)
    shared_trips.join_trip(opened.trip.id, SharedTripJoin(quantity_kg=400, crop_id=crops[bala.email].id), db, bala)
    log.append(f"created  shared trip     #{opened.trip.id} to Palani: Arun 200 kg + Bala 400 kg "
               "(Rs 600 + Rs 1,200); 400 kg free for Chitra to join")
    return log


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--password", default=os.environ.get("DEMO_PASSWORD"))
    parser.add_argument("--allow-non-sqlite", action="store_true")
    args = parser.parse_args()
    check_database_url(settings.DATABASE_URL, args.allow_non_sqlite)

    password = args.password or f"Demo{secrets.token_hex(4)}7"
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        for line in seed_demo(db, password):
            print(line)
    print(f"\nDemo accounts sign in with password: {password}")
    print("Farmers: demo.arun / demo.bala / demo.chitra; operators: demo.selvam / demo.kavitha (all @example.com)")


if __name__ == "__main__":
    main()
