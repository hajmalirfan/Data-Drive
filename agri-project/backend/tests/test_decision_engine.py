"""Acceptance tests AT-01 to AT-18 (CLAUDE.md section 5). Expected values are worked by hand."""
from datetime import date, timedelta
from decimal import Decimal as D

import pytest

from app.services.decision_engine import (
    DIFFERENT_TYPE,
    EMPTY,
    INSUFFICIENT_MARKETS,
    NEEDS_INPUT,
    NO_MARKET_COVERS,
    RANKED,
    SOURCE_ERROR,
    STALE,
    TOO_CLOSE,
    UNIT_UNCLEAR,
    InputError,
    compare,
)

AS_OF = date(2026, 10, 25)
FRESH = date(2026, 10, 24)


def rec(market_id, modal, unit="kg", *, report_date=FRESH, market_type="wholesale", low=None, high=None, sample=False):
    return {
        "market_id": market_id, "market_name": market_id, "market_type": market_type, "crop": "tomato",
        "report_date": report_date, "min_price": low if low is not None else modal,
        "max_price": high if high is not None else modal, "modal_price": modal, "unit": unit,
        "source_name": "Sample" if sample else "AGMARKNET via data.gov.in", "is_sample": sample, "run_status": "SUCCESS",
    }


def market(market_id, trip_cost=None, **extra):
    return {"market_id": market_id, "trip_cost": trip_cost, **extra}


def inputs(markets, quantity=500, capacity=1000, **extra):
    return {"crop": "tomato", "quantity": quantity, "unit": "kg", "vehicle_capacity_kg": capacity, "markets": markets, **extra}


def card(result, market_id):
    return next(c for c in result["cards"] if c["market_id"] == market_id)


def test_at01_units_convert_to_price_per_kg():
    result = compare(inputs([market("A", 1800), market("B", 1800)]), [rec("A", 2800, "quintal"), rec("B", 350, "crate")])
    a, b = card(result, "A"), card(result, "B")
    assert (a["price_per_kg"], a["gross"]) == (D(28), D(14000))
    assert (b["price_per_kg"], b["gross"]) == (D(25), D(12500))


def test_at02_unknown_box_weight_is_unit_unclear():
    result = compare(inputs([market("A", 1800), market("B", 1800)]), [rec("A", 28), rec("B", 350, "box")])
    b = card(result, "B")
    assert (b["eligible"], b["reason"]) == (False, UNIT_UNCLEAR)


def test_at03_three_day_old_price_is_stale():
    result = compare(
        inputs([market("A", 1800), market("B", 1800)]),
        [rec("A", 28, report_date=AS_OF - timedelta(days=1)), rec("B", 25, report_date=AS_OF - timedelta(days=3))],
    )
    assert card(result, "A")["eligible"] is True
    assert card(result, "B")["reason"] == STALE
    assert result["state"] == INSUFFICIENT_MARKETS
    assert result["winner_market_id"] is None


def test_at04_wholesale_and_uzhavar_sandhai_not_ranked_together():
    result = compare(
        inputs([market("A", 1800), market("B", 1800)]),
        [rec("A", 28), rec("B", 30, market_type="uzhavar_sandhai")],
    )
    assert card(result, "B")["reason"] == DIFFERENT_TYPE
    assert result["state"] == INSUFFICIENT_MARKETS
    assert result["winner_market_id"] is None


def test_at05_estimate_without_commission():
    result = compare(inputs([market("A", 1800), market("B", 1800)]), [rec("A", 25), rec("B", 25)])
    assert card(result, "A")["estimate"] == D(10700)
    assert "commission" in result["not_included"]


def test_at06_ten_percent_commission():
    result = compare(
        inputs([market("A", 1800, commission_pct=10), market("B", 1800, commission_pct=10)]),
        [rec("A", 25), rec("B", 25)],
    )
    a = card(result, "A")
    assert (a["commission"], a["estimate"]) == (D(1250), D(9450))
    assert "commission" not in result["not_included"]


def test_at07_one_trip_partial_load():
    result = compare(inputs([market("A", 1800), market("B", 1800)], quantity=600), [rec("A", 25), rec("B", 25)])
    a = card(result, "A")
    assert (a["trips"], a["transport"], a["transport_per_kg"], a["load_fill"]) == (1, D(1800), D(3), D("0.6"))


def test_at08_two_trips():
    result = compare(inputs([market("A", 1800), market("B", 1800)], quantity=1500), [rec("A", 25), rec("B", 25)])
    a = card(result, "A")
    assert (a["trips"], a["transport"], a["transport_per_kg"], a["load_fill"]) == (2, D(3600), D("2.4"), D("0.75"))


def test_at09_blank_trip_cost_needs_input():
    result = compare(inputs([market("A", 1800), market("B")]), [rec("A", 28), rec("B", 25)])
    assert result["state"] == NEEDS_INPUT
    assert result["message"] == "Enter trip cost to see net."
    assert result["winner_market_id"] is None


def test_at09b_zero_needs_no_cost_tick():
    unticked = compare(inputs([market("A", 1800), market("B", 0)]), [rec("A", 28), rec("B", 25)])
    ticked = compare(inputs([market("A", 1800), market("B", None, no_cost=True)]), [rec("A", 28), rec("B", 25)])
    assert unticked["state"] == NEEDS_INPUT
    assert ticked["state"] != NEEDS_INPUT
    assert card(ticked, "B")["transport"] == D(0)


def test_at10_source_error_and_empty_have_different_messages():
    timeout = compare(inputs([market("A", 1800), market("B", 1800)]), [], source_error=True)
    no_rows = compare(inputs([market("A", 1800), market("B", 1800)]), [])
    assert (timeout["state"], no_rows["state"]) == (SOURCE_ERROR, EMPTY)
    assert timeout["message"] == "Could not retrieve data. Try again later."
    assert no_rows["message"] == "No matching records found."
    assert timeout["message"] != no_rows["message"]


def test_at11_one_eligible_market():
    result = compare(inputs([market("A", 1800)]), [rec("A", 28)])
    assert result["state"] == INSUFFICIENT_MARKETS
    assert result["message"] == "Ranking unavailable: fewer than two fresh comparable markets."


def test_at12_too_close_inside_tie_band():
    # 1,000 kg: A 15/kg - 1,800 = 13,200; B 14.80/kg - 1,800 = 13,000; band max(100, 264) = 264
    result = compare(inputs([market("A", 1800), market("B", 1800)], quantity=1000), [rec("A", 1500, "quintal"), rec("B", 1480, "quintal")])
    assert (card(result, "A")["estimate"], card(result, "B")["estimate"]) == (D(13200), D(13000))
    assert result["state"] == TOO_CLOSE
    assert result["tie_band"] == D(264)
    assert result["message"] == "These two are too close to call (difference Rs 200)."
    assert result["winner_market_id"] is None


def test_at13_difference_equal_to_band_is_ranked():
    result = compare(inputs([market("A", 1800), market("B", 1800)], quantity=1000), [rec("A", 1500, "quintal"), rec("B", "1473.6", "quintal")])
    assert card(result, "B")["estimate"] == D(12936)
    assert result["state"] == RANKED
    assert result["winner_market_id"] == "A"


def test_at14_cheaper_trip_beats_higher_price():
    result = compare(
        inputs([market("A", 2500), market("B", 1800), market("C", 1200)]),
        [rec("A", 28), rec("B", 25), rec("C", 26)],
    )
    assert [card(result, m)["estimate"] for m in "ABC"] == [D(11500), D(10700), D(11800)]
    assert result["state"] == RANKED
    assert (result["winner_market_id"], result["lead"]) == ("C", D(300))
    assert result["message"] == "Estimated best: C, about Rs 300 more than A after the costs you entered."


def test_at15_sample_data_is_labelled():
    result = compare(inputs([market("A", 1800), market("B", 1800)]), [rec("A", 28, sample=True), rec("B", 25, sample=True)])
    assert result["data_label"] == "Sample data as of 25 Oct 2026"
    real = compare(inputs([market("A", 1800), market("B", 1800)]), [rec("A", 28), rec("B", 25)])
    assert real["data_label"] is None


@pytest.mark.parametrize("bad, field", [
    ({"quantity": 0}, "quantity"),
    ({"quantity": -5}, "quantity"),
    ({"vehicle_capacity_kg": 0}, "vehicle_capacity_kg"),
    ({"markets": [market("A", -1), market("B", 1800)]}, "markets[0].trip_cost"),
])
def test_at16_invalid_inputs_give_field_errors_and_no_calculation(bad, field):
    with pytest.raises(InputError) as raised:
        compare({**inputs([market("A", 1800), market("B", 1800)]), **bad}, [rec("A", 28), rec("B", 25)])
    assert field in raised.value.errors


def at17_inputs(near, far):
    return compare(
        inputs([market("near", 1800), market("far", 3000)], quantity=700, picking_per_crate=80),
        [rec("near", near, "crate"), rec("far", far, "crate")],
    )


def test_at17_harvest_cover_far_market_wins():
    result = at17_inputs(120, 150)
    near, far = card(result, "near"), card(result, "far")
    assert (near["left_per_crate"], far["left_per_crate"]) == (D(4), D(10))
    assert (near["cover_price_per_crate"], far["cover_price_per_crate"]) == (D(116), D(140))
    assert result["state"] == RANKED
    assert (result["winner_market_id"], result["lead"]) == ("far", D(300))
    assert result["harvest_message"] is None


def test_at18_no_market_covers_and_too_close():
    result = at17_inputs(110, 135)
    near, far = card(result, "near"), card(result, "far")
    assert (near["left_per_crate"], far["left_per_crate"]) == (D(-6), D(-5))
    assert result["harvest_message"] == NO_MARKET_COVERS
    assert "don't harvest" not in result["harvest_message"].lower()
    assert result["state"] == TOO_CLOSE
    assert result["lead"] == D(50)
    assert result["tie_band"] == D(100)
