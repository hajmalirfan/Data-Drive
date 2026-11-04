"""API tests for shared truck trips (spec: docs/superpowers/specs/2026-11-04-shared-truck-trips-design.md).

Routers run in a bare FastAPI app on an in-memory SQLite database, so no shared database,
scheduler or startup hook is touched. Trip fare in every test: 500 + 50 km x 26 = Rs 1,800.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models.pooling  # noqa: F401 - register shared trip tables
from app.core.database import Base, get_db
from app.core.security import create_access_token
from app.models.operations import Market, Notification, Truck
from app.models.user import User
from app.routers import bookings

TABLES = (
    "users", "markets", "market_prices", "crop_stocks", "trucks", "bookings",
    "booking_location_points", "notifications", "shared_trips", "shared_trip_members",
)
USERS = (
    ("a@example.com", "Arun Kumar", "farmer"),
    ("b@example.com", "Bala Murugan", "farmer"),
    ("c@example.com", "Chitra Devi", "farmer"),
    ("op@example.com", "Operator One", "truck_operator"),
)
PICKUP = (datetime.utcnow() + timedelta(days=1)).isoformat()


def auth(email: str) -> dict:
    return {"Authorization": f"Bearer {create_access_token({'sub': email})}"}


A, B, C, OP = (auth(email) for email, _, _ in USERS)


@pytest.fixture()
def client():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine, tables=[Base.metadata.tables[name] for name in TABLES])
    Session = sessionmaker(bind=engine)
    with Session() as db:
        users = {}
        for email, name, role in USERS:
            users[email] = User(email=email, hashed_password="x", full_name=name, role=role)
            db.add(users[email])
        db.flush()
        market = Market(name="Palani", district="Dindigul", distance_km=50)
        truck = Truck(
            operator_id=users["op@example.com"].id, vehicle_number="TN57AB1234", capacity_kg=1000,
            available_capacity_kg=1000, base_fare=500, price_per_km=26, status="available",
        )
        db.add_all([market, truck])
        db.commit()
        ids = {"market": market.id, "truck": truck.id, **{email: user.id for email, user in users.items()}}

    def override_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    api = FastAPI()
    api.include_router(bookings.router)
    api.dependency_overrides[get_db] = override_db
    test_client = TestClient(api)
    test_client.Session = Session
    test_client.ids = ids
    return test_client


def booking_payload(client, kg: float, **extra) -> dict:
    return {
        "truck_id": client.ids["truck"], "market_id": client.ids["market"], "quantity_kg": kg,
        "pickup_location": "Ayakudi bus stand", "destination": "Palani", "pickup_at": PICKUP, **extra,
    }


def test_plain_booking_unchanged(client):
    response = client.post("/api/bookings", json=booking_payload(client, 300), headers=A)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["estimated_transport_cost"] == 1800.0
    assert body["shared_trip_id"] is None
    assert body["shared_trip_member_count"] is None
    with client.Session() as db:
        recipients = {row.user_id for row in db.query(Notification).all()}
    assert recipients == {client.ids["a@example.com"], client.ids["op@example.com"]}
