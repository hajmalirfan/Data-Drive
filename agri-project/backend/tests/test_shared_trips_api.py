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
from app.routers import bookings, shared_trips

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
    api.include_router(shared_trips.router)
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


# ---------- Shared trips API ----------

def open_trip(client, headers=A, kg: float = 300, **extra):
    payload = {**booking_payload(client, kg), "pickup_point": "Ayakudi bus stand", **extra}
    return client.post("/api/shared-trips", json=payload, headers=headers)


def join(client, trip_id: int, headers, kg: float, **extra):
    return client.post(f"/api/shared-trips/{trip_id}/join", json={"quantity_kg": kg, **extra}, headers=headers)


def opened(client, headers=A, kg: float = 300, **extra) -> dict:
    response = open_trip(client, headers, kg, **extra)
    assert response.status_code == 201, response.text
    return response.json()


def notifications_for(client, email: str) -> list:
    with client.Session() as db:
        return db.query(Notification).filter(Notification.user_id == client.ids[email]).all()


def ist(dt: datetime) -> str:
    """A naive UTC time written as Indian local time with its +05:30 offset."""
    return f"{(dt + timedelta(hours=5, minutes=30)).isoformat(timespec='seconds')}+05:30"


def test_open_and_list_hides_names(client):
    body = opened(client)
    trip, booking = body["trip"], body["booking"]
    assert trip["trip_fare"] == 1800.0
    assert trip["member_count"] == 1
    assert booking["estimated_transport_cost"] == 1800.0
    assert booking["shared_trip_id"] == trip["id"]

    listed = client.get("/api/shared-trips", headers=B)
    assert listed.status_code == 200, listed.text
    [item] = listed.json()
    assert item["kg_free"] == 700.0
    assert item["is_member"] is False
    assert "Arun" not in listed.text and "phone" not in listed.text
    assert client.get("/api/shared-trips", headers=A).json()[0]["is_member"] is True


def test_quote_matches_split(client):
    trip = opened(client)["trip"]
    quote = client.get(f"/api/shared-trips/{trip['id']}/quote", params={"quantity_kg": 600}, headers=B)
    assert quote.status_code == 200, quote.text
    assert quote.json() == {"share": 1200.0, "alone": 1800.0, "saving": 600.0}

    joined = join(client, trip["id"], B, 600)
    assert joined.status_code == 201, joined.text
    assert joined.json()["estimated_transport_cost"] == 1200.0
    opener_booking = client.get("/api/bookings", headers=A).json()[0]
    assert opener_booking["estimated_transport_cost"] == 600.0
    assert opener_booking["shared_trip_member_count"] == 2
    assert any("now Rs 600 (was Rs 1,800)" in n.message for n in notifications_for(client, "a@example.com"))
    assert not any(n.title == "Shared trip share updated" for n in notifications_for(client, "b@example.com"))


def test_join_boundary(client):
    trip = opened(client)["trip"]
    too_much = join(client, trip["id"], B, 701)
    assert too_much.status_code == 400
    assert too_much.json()["detail"] == "Only 700 kg is free on this trip"
    assert join(client, trip["id"], B, 700).status_code == 201
    full = join(client, trip["id"], C, 1)
    assert full.status_code == 409
    assert full.json()["detail"] == "This trip has no space left"


def test_already_member(client):
    trip = opened(client)["trip"]
    response = join(client, trip["id"], A, 100)
    assert response.status_code == 409
    assert response.json()["detail"] == "You are already on this trip"


def test_closed_and_past_pickup(client):
    from app.models.pooling import SharedTrip

    trip = opened(client)["trip"]
    closed = client.post(f"/api/shared-trips/{trip['id']}/close", headers=A)
    assert closed.status_code == 200, closed.text
    assert closed.json()["status"] == "closed"
    response = join(client, trip["id"], B, 100)
    assert response.status_code == 409
    assert response.json()["detail"] == "This trip is closed to new members"

    late = opened(client)["trip"]
    with client.Session() as db:
        db.get(SharedTrip, late["id"]).pickup_at = datetime.utcnow() - timedelta(days=1)
        db.commit()
    response = join(client, late["id"], B, 100)
    assert response.status_code == 409
    assert response.json()["detail"] == "The pickup time for this trip has passed"
    assert client.get("/api/shared-trips", headers=B).json() == []


def test_close_by_non_opener(client):
    trip = opened(client)["trip"]
    assert client.post(f"/api/shared-trips/{trip['id']}/close", headers=B).status_code == 403


def test_detail_permissions(client):
    trip = opened(client)["trip"]
    assert join(client, trip["id"], B, 600).status_code == 201
    detail = client.get(f"/api/shared-trips/{trip['id']}", headers=B)
    assert detail.status_code == 200, detail.text
    members = detail.json()["members"]
    assert [m["first_name"] for m in members] == ["Arun", "Bala"]
    assert [m["share"] for m in members] == [600.0, 1200.0]
    assert client.get(f"/api/shared-trips/{trip['id']}", headers=OP).status_code == 200
    assert client.get(f"/api/shared-trips/{trip['id']}", headers=C).status_code == 403


def test_mine_lists_my_trips(client):
    trip = opened(client)["trip"]
    client.post(f"/api/shared-trips/{trip['id']}/close", headers=A)
    mine = client.get("/api/shared-trips", params={"mine": "true"}, headers=A).json()
    assert [(t["id"], t["status"]) for t in mine] == [(trip["id"], "closed")]
    assert client.get("/api/shared-trips", params={"mine": "true"}, headers=C).json() == []


def test_offset_pickup_time(client):
    soon = opened(client, pickup_at=ist(datetime.utcnow() + timedelta(hours=3)))["trip"]
    assert join(client, soon["id"], B, 100).status_code == 201
    gone = opened(client, pickup_at=ist(datetime.utcnow() - timedelta(hours=1)))["trip"]
    response = join(client, gone["id"], C, 100)
    assert response.status_code == 409
    assert response.json()["detail"] == "The pickup time for this trip has passed"


def test_join_with_foreign_crop(client):
    from app.models.operations import CropStock

    trip = opened(client)["trip"]
    with client.Session() as db:
        crop = CropStock(owner_id=client.ids["c@example.com"], crop_name="Tomato", quantity_kg=500)
        db.add(crop)
        db.commit()
        crop_id = crop.id
    assert join(client, trip["id"], B, 100, crop_id=crop_id).status_code == 403
