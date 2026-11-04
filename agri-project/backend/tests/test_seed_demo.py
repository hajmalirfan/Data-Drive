"""Tests for the demo seed (scripts/seed_demo.py) on an in-memory SQLite database."""
from datetime import datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.core.security import verify_password
from app.models.operations import Booking, CropStock, Market, MarketPrice, Truck
from app.models.pooling import SharedTrip
from app.models.user import User
from app.services.trip_pooling import space_left_kg
from scripts.seed_demo import check_database_url, seed_demo

PASSWORD = "Seedtest-2468"


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    with sessionmaker(bind=engine)() as session:
        yield session


def counts(db) -> dict:
    return {
        model.__tablename__: db.query(model).count()
        for model in (User, Market, MarketPrice, Truck, CropStock, Booking, SharedTrip)
    }


def test_seed_creates_demo_world(db):
    seed_demo(db, PASSWORD)
    roles = sorted(user.role for user in db.query(User).all())
    assert roles == ["farmer", "farmer", "farmer", "truck_operator", "truck_operator"]
    assert all(verify_password(PASSWORD, user.hashed_password) for user in db.query(User).all())
    assert counts(db) == {
        "users": 5, "markets": 4, "market_prices": 12, "trucks": 3,
        "crop_stocks": 3, "bookings": 2, "shared_trips": 1,
    }
    [trip] = db.query(SharedTrip).all()
    assert trip.status == "open" and trip.trip_fare == 1800.0
    assert trip.pickup_at > datetime.utcnow()
    shares = sorted(member.booking.estimated_transport_cost for member in trip.members)
    assert shares == [600.0, 1200.0]
    # The third farmer's whole crop must fit, so the demo can show her joining.
    chitra_kg = db.query(CropStock).join(User).filter(User.email == "demo.chitra@example.com").one().quantity_kg
    assert space_left_kg(trip) >= chitra_kg


def test_seed_twice_adds_nothing(db):
    seed_demo(db, PASSWORD)
    before = counts(db)
    seed_demo(db, PASSWORD)
    assert counts(db) == before


def test_seed_rejects_a_weak_password(db):
    with pytest.raises(SystemExit):
        seed_demo(db, "short")


def test_only_sqlite_by_default():
    check_database_url("sqlite:///./local-demo.db", allow_other=False)
    with pytest.raises(SystemExit):
        check_database_url("postgresql+psycopg2://user@db.example.com/agri", allow_other=False)
    check_database_url("postgresql+psycopg2://user@db.example.com/agri", allow_other=True)
