"""API tests for the guest decision flow (PRD v4.2, QA prompt P5 and P6).

The router runs in a bare FastAPI app on an in-memory SQLite database seeded with
the PRD sample, so no shared database, scheduler or startup hook is touched.
"""
from datetime import date
from decimal import Decimal as D

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.security import create_access_token
from app.core.security_policy import limiter
from app.models.decision import DecisionMarket, MarketCrop, Region
from app.routers import decision
from app.services.decision_seed import seed_sample

BATCH = {"crop": "tomato", "quantity": 700, "unit": "kg", "vehicle_capacity_kg": 1000, "picking_per_crate": 80}


@pytest.fixture()
def client():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    tables = [t for name, t in Base.metadata.tables.items()
              if name in ("regions", "decision_markets", "decision_market_crops", "unit_conversions",
                          "ingestion_runs", "price_records")]
    Base.metadata.create_all(bind=engine, tables=tables)
    Session = sessionmaker(bind=engine)
    with Session() as db:
        seed_sample(db)
        # Two configured tomato markets with no price rows, for the EMPTY state.
        region = db.query(Region).first()
        for slug in ("empty-a", "empty-b"):
            market = DecisionMarket(slug=slug, name=slug, region_id=region.id, market_type="wholesale", enabled=True)
            db.add(market)
            db.flush()
            db.add(MarketCrop(market_id=market.id, crop="tomato"))
        # A disabled market is never offered.
        db.add(DecisionMarket(slug="disabled", name="Disabled", region_id=region.id, market_type="wholesale", enabled=False))
        db.commit()

    def override_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(decision.router)
    app.dependency_overrides[get_db] = override_db
    limiter._hits.clear()
    test_client = TestClient(app)
    test_client.app_ref = app
    token = test_client.post("/api/auth/guest").json()["access_token"]
    test_client.headers["Authorization"] = f"Bearer {token}"
    return test_client


def compare(client, markets, **extra):
    return client.post("/api/decision/compare", json={**BATCH, **extra, "markets": markets})


def card(result, market_id):
    return next(c for c in result["cards"] if c["market_id"] == market_id)


def test_guest_token_is_required(client):
    anonymous = TestClient(client.app_ref)
    assert anonymous.get("/api/decision/options").status_code == 401
    # A normal sign-in token (no guest purpose) is not a guest token.
    user_token = create_access_token({"sub": "farmer@example.com", "role": "farmer"})
    assert anonymous.get("/api/decision/options", headers={"Authorization": f"Bearer {user_token}"}).status_code == 401


def test_options_list_seeded_markets_with_sample_badge(client):
    body = client.get("/api/decision/options").json()
    assert body["data"] == {"mode": "sample", "label": "Sample data as of 25 Oct 2026"}
    tomato = body["regions"][0]["crops"][0]
    assert tomato["crop"] == "tomato"
    ids = {m["id"] for m in tomato["markets"]}
    assert {"oddanchatram", "palani", "dindigul", "natham"} <= ids
    assert "disabled" not in ids


def test_ranked_worked_example(client):
    response = compare(client, [{"market_id": "oddanchatram", "trip_cost": 1800}, {"market_id": "palani", "trip_cost": 3000}])
    result = response.json()
    assert response.status_code == 200
    assert result["state"] == "RANKED"
    assert result["winner_market_id"] == "palani"
    assert result["lead"] == 300
    assert result["message"] == "Estimated best: Palani, about Rs 300 more than Oddanchatram after the costs you entered."
    assert (card(result, "oddanchatram")["left_per_crate"], card(result, "palani")["left_per_crate"]) == (4, 10)
    assert (card(result, "oddanchatram")["cover_price_per_crate"], card(result, "palani")["cover_price_per_crate"]) == (116, 140)
    assert result["data"]["label"] == "Sample data as of 25 Oct 2026"
    assert card(result, "palani")["source"] == "Sample"


def test_too_close(client):
    # Oddanchatram 6,000 - 1,800 = 4,200; Palani 7,500 - 3,250 = 4,250: Rs 50 apart, band Rs 100.
    result = compare(client, [{"market_id": "oddanchatram", "trip_cost": 1800}, {"market_id": "palani", "trip_cost": 3250}]).json()
    assert result["state"] == "TOO_CLOSE"
    assert result["message"] == "These two are too close to call (difference Rs 50)."
    assert result["winner_market_id"] is None


def test_needs_input_when_trip_cost_blank_or_unticked_zero(client):
    blank = compare(client, [{"market_id": "oddanchatram", "trip_cost": 1800}, {"market_id": "dindigul"}]).json()
    zero = compare(client, [{"market_id": "oddanchatram", "trip_cost": 1800}, {"market_id": "dindigul", "trip_cost": 0}]).json()
    ticked = compare(client, [{"market_id": "oddanchatram", "trip_cost": 1800}, {"market_id": "dindigul", "no_cost": True}]).json()
    assert (blank["state"], zero["state"]) == ("NEEDS_INPUT", "NEEDS_INPUT")
    assert blank["message"] == "Enter trip cost to see net."
    assert blank["winner_market_id"] is None
    assert ticked["state"] != "NEEDS_INPUT"


def test_insufficient_markets_wholesale_vs_uzhavar_sandhai(client):
    result = compare(client, [{"market_id": "oddanchatram", "trip_cost": 1800}, {"market_id": "dindigul-uzhavar-sandhai", "trip_cost": 900}]).json()
    assert result["state"] == "INSUFFICIENT_MARKETS"
    assert result["message"] == "Ranking unavailable: fewer than two fresh comparable markets."
    assert card(result, "dindigul-uzhavar-sandhai")["reason"] == "different market type"


def test_no_fresh_data(client):
    client.app_ref.dependency_overrides[decision.decision_config] = lambda: {
        **decision.decision_config(), "as_of": date(2026, 11, 30),
    }
    result = compare(client, [{"market_id": "oddanchatram", "trip_cost": 1800}, {"market_id": "palani", "trip_cost": 3000}]).json()
    assert result["state"] == "NO_FRESH_DATA"
    assert result["message"] == "Prices are too old to compare."


def test_empty(client):
    result = compare(client, [{"market_id": "empty-a", "trip_cost": 1800}, {"market_id": "empty-b", "trip_cost": 3000}]).json()
    assert result["state"] == "EMPTY"
    assert result["message"] == "No matching records found."


def test_disabled_market_is_a_field_error(client):
    response = compare(client, [{"market_id": "disabled", "trip_cost": 1800}, {"market_id": "palani", "trip_cost": 3000}])
    assert response.status_code == 422
    assert "markets[0].market_id" in response.json()["detail"]["errors"]


def test_source_error_differs_from_empty(client, monkeypatch):
    def broken(*args, **kwargs):
        raise OperationalError("SELECT 1", {}, Exception("connection refused"))

    monkeypatch.setattr(decision, "enabled_markets", broken)
    result = compare(client, [{"market_id": "oddanchatram", "trip_cost": 1800}, {"market_id": "palani", "trip_cost": 3000}]).json()
    assert result["state"] == "SOURCE_ERROR"
    assert result["message"] == "Could not retrieve data. Try again later."
    assert result["winner_market_id"] is None


def test_exclusion_reasons_for_seed_markets(client):
    pairs = [("vedasandur", "different report date"), ("batlagundu", "stale"), ("nilakottai", "unit unclear"), ("natham", "price invalid")]
    for market_id, reason in pairs:
        result = compare(client, [
            {"market_id": "oddanchatram", "trip_cost": 1800}, {"market_id": "palani", "trip_cost": 3000},
            {"market_id": market_id, "trip_cost": 1000},
        ]).json()
        excluded = card(result, market_id)
        assert (excluded["eligible"], excluded["reason"]) == (False, reason)
        assert excluded["reason_text"]
        assert result["state"] == "RANKED"  # the two comparable markets still rank


@pytest.mark.parametrize("change, field", [
    ({"quantity": 0}, "quantity"),
    ({"quantity": -5}, "quantity"),
    ({"vehicle_capacity_kg": 0}, "vehicle_capacity_kg"),
    ({"crop": "potato"}, "crop"),
])
def test_field_errors_give_no_result(client, change, field):
    response = compare(client, [{"market_id": "oddanchatram", "trip_cost": 1800}, {"market_id": "palani", "trip_cost": 3000}], **change)
    assert response.status_code == 422
    assert field in response.json()["detail"]["errors"]


def test_negative_cost_and_market_count_are_field_errors(client):
    negative = compare(client, [{"market_id": "oddanchatram", "trip_cost": -1}, {"market_id": "palani", "trip_cost": 3000}])
    one = compare(client, [{"market_id": "oddanchatram", "trip_cost": 1800}])
    assert "markets[0].trip_cost" in negative.json()["detail"]["errors"]
    assert "markets" in one.json()["detail"]["errors"]


def test_no_price_is_called_live(client):
    response = compare(client, [{"market_id": "oddanchatram", "trip_cost": 1800}, {"market_id": "palani", "trip_cost": 3000}])
    assert "live" not in response.text.lower()


def test_as_of_defaults_to_demo_date_for_sample_and_today_for_snapshot(monkeypatch):
    monkeypatch.setattr(decision.settings, "DECISION_AS_OF", "")
    monkeypatch.setattr(decision.settings, "DECISION_DATA_MODE", "sample")
    assert decision.decision_config()["as_of"] == date(2026, 10, 25)
    monkeypatch.setattr(decision.settings, "DECISION_DATA_MODE", "snapshot")
    assert decision.decision_config()["as_of"] == decision.datetime.now(decision.IST).date()


def test_tie_band_percent_never_uses_scientific_notation():
    config = {**decision.decision_config(), "tie_band_pct": D("10.0")}
    assert any("or 10% apart" in line for line in decision.assumptions(config))
