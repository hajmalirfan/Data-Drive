"""Terminal demo of the decision engine: one scenario per result state.

Run from agri-project/backend:  python -m scripts.decision_demo
Prices come from the PRD v4.2 sample seed (labelled "Sample data as of 25 Oct 2026")
or, where the seed gives no figure, from the PRD worked example / acceptance tests.
"""
from datetime import date

from app.services.decision_engine import compare, inr

OCT24, OCT21 = date(2026, 10, 24), date(2026, 10, 21)


def seed(market_id, name, modal, unit, *, market_type="wholesale", report_date=OCT24, low=None, high=None):
    return {
        "market_id": market_id, "market_name": name, "market_type": market_type, "crop": "tomato",
        "report_date": report_date, "min_price": low if low is not None else modal,
        "max_price": high if high is not None else modal, "modal_price": modal, "unit": unit,
        "source_name": "Sample", "is_sample": True, "run_status": "SUCCESS",
    }


ODDANCHATRAM = seed("odd", "Oddanchatram", 120, "crate")
DINDIGUL = seed("dgl", "Dindigul", 1050, "quintal")
PALANI = seed("pal", "Palani", 150, "crate")
UZHAVAR = seed("dus", "Dindigul Uzhavar Sandhai", 13, "kg", market_type="uzhavar_sandhai")

BATCH = {"crop": "tomato", "quantity": 700, "unit": "kg", "vehicle_capacity_kg": 1000, "picking_per_crate": 80}


def run(title, markets, records, **flags):
    result = compare({**BATCH, "markets": markets}, records, **flags)
    print(f"\n=== {title}")
    if result["data_label"]:
        print(f"[{result['data_label']}]")
    print(f"{result['state']}: {result['message']}")
    if result["harvest_message"]:
        print(f"Harvest cover: {result['harvest_message']}")
    for c in result["cards"]:
        if c["eligible"] and c["estimate"] is not None:
            print(
                f"  {c['market_name']:<26} Rs {inr(c['price_per_crate'])}/crate  estimate Rs {inr(c['estimate'])}"
                f"  left/crate Rs {inr(c['left_per_crate'])}  cover price Rs {inr(c['cover_price_per_crate'])}"
            )
        elif c["eligible"]:
            print(f"  {c['market_name']:<26} eligible, trip cost missing")
        else:
            print(f"  {c['market_name']:<26} excluded: {c['reason']}")
    if result["not_included"]:
        print("  Not included:", ", ".join(result["not_included"]))


if __name__ == "__main__":
    print("700 kg (50 crates) of tomato, picking Rs 80 per crate, 1,000 kg vehicle.")
    run("RANKED (seed prices, worked-example trip costs)",
        [{"market_id": "odd", "trip_cost": 1800}, {"market_id": "pal", "trip_cost": 3000}], [ODDANCHATRAM, PALANI])
    run("TOO_CLOSE (AT-18 prices: 110 vs 135 per crate)",
        [{"market_id": "odd", "trip_cost": 1800}, {"market_id": "pal", "trip_cost": 3000}],
        [seed("odd", "Oddanchatram", 110, "crate"), seed("pal", "Palani", 135, "crate")])
    run("NEEDS_INPUT (Dindigul trip cost left blank)",
        [{"market_id": "odd", "trip_cost": 1800}, {"market_id": "dgl", "trip_cost": None}], [ODDANCHATRAM, DINDIGUL])
    run("INSUFFICIENT_MARKETS (wholesale vs Uzhavar Sandhai)",
        [{"market_id": "odd", "trip_cost": 1800}, {"market_id": "dus", "trip_cost": 900}], [ODDANCHATRAM, UZHAVAR])
    run("NO_FRESH_DATA (both prices dated 21 Oct)",
        [{"market_id": "odd", "trip_cost": 1800}, {"market_id": "pal", "trip_cost": 3000}],
        [seed("odd", "Oddanchatram", 120, "crate", report_date=OCT21), seed("pal", "Palani", 150, "crate", report_date=OCT21)])
    run("SOURCE_ERROR (database or feed unreachable)",
        [{"market_id": "odd", "trip_cost": 1800}, {"market_id": "pal", "trip_cost": 3000}], [], source_error=True)
    run("EMPTY (no rows for this crop and market)",
        [{"market_id": "odd", "trip_cost": 1800}, {"market_id": "pal", "trip_cost": 3000}], [])
