"""Selling-decision engine (PRD v4.1, CLAUDE.md section 4).

Pure functions only: no database, HTTP or FastAPI imports, so every rule can be
tested with literal values. All money is Decimal and is never rounded before
ranking; round only when displaying.

Inputs are plain dicts:

* ``inputs``: crop, quantity, unit, vehicle_capacity_kg, picking_per_crate,
  packing_per_crate, markets=[{market_id, trip_cost, no_cost, commission_pct,
  commission_flat, loading, handling}]
* ``records``: one latest price record per market: market_id, market_name,
  market_type, crop, report_date (date), min_price, max_price, modal_price,
  unit, source_name, is_sample, run_status
* ``config``: as_of (date), freshness_days, tie_band_floor, tie_band_pct,
  crate_kg, unit_kg ({unit: kg per unit})
"""
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from math import ceil

ZERO = Decimal("0")
HUNDRED = Decimal("100")

DEFAULT_CONFIG = {
    "as_of": date(2026, 10, 25),
    "freshness_days": 2,
    "tie_band_floor": Decimal("100"),
    "tie_band_pct": Decimal("2"),
    "crate_kg": Decimal("14"),
    "unit_kg": {"kg": Decimal("1"), "quintal": Decimal("100"), "tonne": Decimal("1000"), "crate": Decimal("14")},
    "sample_label": "Sample data as of 25 Oct 2026",
}

# Result states, first match wins (CLAUDE.md section 4).
SOURCE_ERROR = "SOURCE_ERROR"
EMPTY = "EMPTY"
NO_FRESH_DATA = "NO_FRESH_DATA"
INSUFFICIENT_MARKETS = "INSUFFICIENT_MARKETS"
NEEDS_INPUT = "NEEDS_INPUT"
TOO_CLOSE = "TOO_CLOSE"
RANKED = "RANKED"

MESSAGES = {
    SOURCE_ERROR: "Could not retrieve data. Try again later.",
    EMPTY: "No matching records found.",
    NO_FRESH_DATA: "Prices are too old to compare.",
    INSUFFICIENT_MARKETS: "Ranking unavailable: fewer than two fresh comparable markets.",
    NEEDS_INPUT: "Enter trip cost to see net.",
}
NO_MARKET_COVERS = (
    "At these figures, no compared market covers picking and selling costs. "
    "Check buyer quotes and costs before arranging labour."
)

# Exclusion reasons shown to the farmer.
STALE = "stale"
UNIT_UNCLEAR = "unit unclear"
DIFFERENT_TYPE = "different market type"
DIFFERENT_DATE = "different report date"
PRICE_INVALID = "price invalid"
SOURCE_FAILED = "source run failed"
SOURCE_UNKNOWN = "source unknown"
DATE_UNKNOWN = "report date unknown"
TYPE_UNKNOWN = "market type unknown"
DIFFERENT_CROP = "different crop"


class InputError(ValueError):
    """Farmer inputs failed validation; ``errors`` maps field name to message."""

    def __init__(self, errors: dict):
        super().__init__("; ".join(f"{field}: {msg}" for field, msg in errors.items()))
        self.errors = errors


def dec(value) -> Decimal | None:
    """Decimal from user or database input; None stays None (blank is not zero)."""
    if value is None or value == "":
        return None
    return value if isinstance(value, Decimal) else Decimal(str(value))


def config_with(overrides: dict | None = None) -> dict:
    merged = dict(DEFAULT_CONFIG)
    merged.update(overrides or {})
    return merged


def kg_per_unit(unit: str | None, config: dict) -> Decimal | None:
    """Kilograms in one unit, or None when the unit's weight is unknown (e.g. 'box')."""
    if not unit:
        return None
    return config["unit_kg"].get(unit.strip().lower())


def to_price_per_kg(modal_price, unit: str | None, config: dict) -> Decimal | None:
    kg = kg_per_unit(unit, config)
    modal = dec(modal_price)
    if kg is None or modal is None:
        return None
    return modal / kg


def quantity_kg(quantity, unit: str, config: dict) -> Decimal:
    kg = kg_per_unit(unit, config)
    if kg is None:
        raise InputError({"unit": "Choose kg, quintal, tonne or crate."})
    return dec(quantity) * kg


def age_days(record: dict, as_of: date) -> int | None:
    report = record.get("report_date")
    return None if report is None else (as_of - report).days


def validate_inputs(inputs: dict, config: dict) -> dict:
    """Field errors for impossible inputs (AT-16). Blank optional costs are allowed."""
    errors = {}
    quantity = dec(inputs.get("quantity"))
    if quantity is None or quantity <= 0:
        errors["quantity"] = "Enter a quantity above 0."
    if kg_per_unit(inputs.get("unit"), config) is None:
        errors["unit"] = "Choose kg, quintal, tonne or crate."
    capacity = dec(inputs.get("vehicle_capacity_kg"))
    if capacity is None or capacity <= 0:
        errors["vehicle_capacity_kg"] = "Enter the vehicle capacity in kg (above 0)."
    for field in ("picking_per_crate", "packing_per_crate"):
        value = dec(inputs.get(field))
        if value is not None and value < 0:
            errors[field] = "Cost cannot be negative."
    for i, market in enumerate(inputs.get("markets") or []):
        for field in ("trip_cost", "commission_pct", "commission_flat", "loading", "handling"):
            value = dec(market.get(field))
            if value is not None and value < 0:
                errors[f"markets[{i}].{field}"] = "Cost cannot be negative."
        pct = dec(market.get("commission_pct"))
        if pct is not None and pct >= 100:
            errors[f"markets[{i}].commission_pct"] = "Commission must be below 100%."
    return errors


def check_record(record: dict, crop: str, config: dict) -> str | None:
    """Reason a record cannot rank on its own, or None. Order matters: first match wins."""
    if record.get("run_status", "SUCCESS") != "SUCCESS":
        return SOURCE_FAILED
    if (record.get("crop") or "").strip().lower() != crop.strip().lower():
        return DIFFERENT_CROP
    if not record.get("source_name"):
        return SOURCE_UNKNOWN
    if record.get("report_date") is None:
        return DATE_UNKNOWN
    if not record.get("market_type"):
        return TYPE_UNKNOWN
    if kg_per_unit(record.get("unit"), config) is None:
        return UNIT_UNCLEAR
    low, modal, high = dec(record.get("min_price")), dec(record.get("modal_price")), dec(record.get("max_price"))
    if None in (low, modal, high) or modal <= 0 or not (low <= modal <= high):
        return PRICE_INVALID
    age = age_days(record, config["as_of"])
    if age < 0 or age > config["freshness_days"]:
        return STALE
    return None


def _reference(values: list, order: list):
    """Most common value; ties go to the earliest in ``order``."""
    counts = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    best = max(counts.values())
    tied = [value for value in counts if counts[value] == best]
    return min(tied, key=lambda value: order.index(value) if value in order else len(order))


def check_eligibility(records: list[dict], crop: str, config: dict, market_order: list) -> dict:
    """Map market_id -> exclusion reason (None = eligible). Peers must share market type and report date."""
    reasons = {r["market_id"]: check_record(r, crop, config) for r in records}
    valid = [r for r in records if reasons[r["market_id"]] is None]
    if valid:
        by_order = sorted(valid, key=lambda r: market_order.index(r["market_id"]) if r["market_id"] in market_order else 0)
        ref_type = _reference([r["market_type"] for r in by_order], [r["market_type"] for r in by_order])
        same_type = [r for r in valid if r["market_type"] == ref_type]
        for r in valid:
            if r["market_type"] != ref_type:
                reasons[r["market_id"]] = DIFFERENT_TYPE
        # Ties between report dates go to the newest date.
        dates = sorted({r["report_date"] for r in same_type}, reverse=True)
        ref_date = _reference([r["report_date"] for r in same_type], dates)
        for r in same_type:
            if r["report_date"] != ref_date:
                reasons[r["market_id"]] = DIFFERENT_DATE
    return reasons


def gross_value(modal_price, unit: str, qty_kg: Decimal, config: dict) -> Decimal:
    """modal x quantity / kg-per-unit: multiplying first keeps exact values exact (150/crate x 700 kg)."""
    return dec(modal_price) * qty_kg / kg_per_unit(unit, config)


def compute_costs(gross: Decimal, qty_kg: Decimal, capacity_kg: Decimal, market: dict) -> dict:
    """Transport and other selling costs for one market (blank costs are listed as not included)."""
    not_included = []
    trips = ceil(qty_kg / capacity_kg)
    trip_cost = ZERO if market.get("no_cost") else dec(market.get("trip_cost"))
    if not market.get("no_cost") and trip_cost == ZERO:
        trip_cost = None  # zero needs the explicit "no cost" tick
    transport = None if trip_cost is None else trip_cost * trips

    pct = dec(market.get("commission_pct"))
    flat_commission = dec(market.get("commission_flat"))
    if pct is not None:
        commission = gross * pct / HUNDRED
    elif flat_commission is not None:
        commission = flat_commission
    else:
        commission = ZERO
        not_included.append("commission")
    loading = dec(market.get("loading"))
    handling = dec(market.get("handling"))
    if loading is None:
        not_included.append("loading")
    if handling is None:
        not_included.append("handling")
    flat_other = (loading or ZERO) + (handling or ZERO) + (flat_commission if pct is None and flat_commission is not None else ZERO)
    other = (loading or ZERO) + (handling or ZERO) + commission

    return {
        "gross": gross,
        "trips": trips,
        "transport": transport,
        "transport_per_kg": None if transport is None else transport / qty_kg,
        "load_fill": qty_kg / (trips * capacity_kg),
        "commission": commission,
        "other": other,
        "flat_other": flat_other,
        "commission_pct": pct or ZERO,
        "estimate": None if transport is None else gross - transport - other,
        "not_included": not_included,
    }


def harvest_cover(costs: dict, qty_kg: Decimal, picking, packing, config: dict) -> dict:
    """FR-21: money left per crate after picking and selling costs, and the price per crate that covers them."""
    picking, packing = dec(picking), dec(packing)
    if picking is None or costs["estimate"] is None:
        return {"left_per_crate": None, "cover_price_per_crate": None, "covers": None}
    crates = qty_kg / config["crate_kg"]
    harvest_cost = crates * (picking + (packing or ZERO))
    left = (costs["estimate"] - harvest_cost) / crates
    cover = (costs["transport"] + costs["flat_other"] + harvest_cost) / (crates * (1 - costs["commission_pct"] / HUNDRED))
    return {
        "crates": crates,
        "harvest_cost": harvest_cost,
        "left_per_crate": left,
        "cover_price_per_crate": cover,
        "covers": left >= 0,
    }


def tie_band(higher_estimate: Decimal, config: dict) -> Decimal:
    return max(config["tie_band_floor"], higher_estimate * config["tie_band_pct"] / HUNDRED)


def inr(amount: Decimal) -> str:
    """Whole rupees with Indian digit grouping, for messages (e.g. 1,23,456)."""
    whole = int(amount.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    sign, digits = ("-" if whole < 0 else ""), str(abs(whole))
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        digits = ",".join([head, *groups, tail]) if head else ",".join([*groups, tail])
    return f"{sign}{digits}"


def choose_state(cards: list[dict], *, source_error: bool, any_records: bool, any_fresh: bool, config: dict) -> dict:
    """Pick the first matching result state (CLAUDE.md section 4)."""
    if source_error:
        return {"state": SOURCE_ERROR}
    if not any_records:
        return {"state": EMPTY}
    if not any_fresh:
        return {"state": NO_FRESH_DATA}
    eligible = [c for c in cards if c["eligible"]]
    if len(eligible) < 2:
        return {"state": INSUFFICIENT_MARKETS}
    if any(c["estimate"] is None for c in eligible):
        return {"state": NEEDS_INPUT}
    ranked = sorted(eligible, key=lambda c: c["estimate"], reverse=True)
    top, second = ranked[0], ranked[1]
    lead = top["estimate"] - second["estimate"]
    band = tie_band(top["estimate"], config)
    if lead < band:
        return {
            "state": TOO_CLOSE, "lead": lead, "tie_band": band, "order": ranked,
            "message": f"These two are too close to call (difference Rs {inr(lead)}).",
        }
    return {
        "state": RANKED, "lead": lead, "tie_band": band, "order": ranked, "winner_market_id": top["market_id"],
        "message": (
            f"Estimated best: {top['market_name']}, about Rs {inr(lead)} more than "
            f"{second['market_name']} after the costs you entered."
        ),
    }


def compare(inputs: dict, records: list[dict], config: dict | None = None, *, source_error: bool = False) -> dict:
    """Rank the selected markets for one batch. Raises InputError for impossible inputs (no calculation)."""
    config = config_with(config)
    errors = validate_inputs(inputs, config)
    if errors:
        raise InputError(errors)

    crop = inputs["crop"]
    qty = quantity_kg(inputs["quantity"], inputs["unit"], config)
    capacity = dec(inputs["vehicle_capacity_kg"])
    market_inputs = {m["market_id"]: m for m in inputs.get("markets") or []}
    order = list(market_inputs)
    records = [r for r in records if not market_inputs or r["market_id"] in market_inputs]

    reasons = check_eligibility(records, crop, config, order) if records else {}
    any_fresh = any(
        r.get("report_date") is not None and 0 <= age_days(r, config["as_of"]) <= config["freshness_days"]
        for r in records
    )

    cards, not_included = [], set()
    for record in records:
        reason = reasons[record["market_id"]]
        age = age_days(record, config["as_of"])
        card = {
            "market_id": record["market_id"],
            "market_name": record.get("market_name", str(record["market_id"])),
            "market_type": record.get("market_type"),
            "price": dec(record.get("modal_price")),
            "min_price": dec(record.get("min_price")),
            "max_price": dec(record.get("max_price")),
            "unit": record.get("unit"),
            "report_date": record.get("report_date"),
            "source": record.get("source_name"),
            "is_sample": bool(record.get("is_sample")),
            "age_days": age,
            "freshness": None if age is None else ("Fresh" if 0 <= age <= config["freshness_days"] else "Stale"),
            "eligible": reason is None,
            "reason": reason,
            "price_per_kg": None, "gross": None, "transport": None, "estimate": None,
            "left_per_crate": None, "cover_price_per_crate": None,
        }
        price_per_kg = to_price_per_kg(record.get("modal_price"), record.get("unit"), config) if reason in (None, STALE, DIFFERENT_TYPE, DIFFERENT_DATE) else None
        if reason is None:
            gross = gross_value(record["modal_price"], record["unit"], qty, config)
            costs = compute_costs(gross, qty, capacity, market_inputs.get(record["market_id"], {}))
            cover = harvest_cover(costs, qty, inputs.get("picking_per_crate"), inputs.get("packing_per_crate"), config)
            card.update({k: costs[k] for k in ("gross", "transport", "transport_per_kg", "trips", "load_fill", "commission", "other", "estimate")})
            card.update({k: cover[k] for k in ("left_per_crate", "cover_price_per_crate", "covers")})
            card["price_per_crate"] = dec(record["modal_price"]) * config["crate_kg"] / kg_per_unit(record["unit"], config)
            not_included.update(costs["not_included"])
        card["price_per_kg"] = price_per_kg
        cards.append(card)

    if any(c["eligible"] for c in cards):
        if dec(inputs.get("picking_per_crate")) is None:
            not_included.add("picking cost")
        if dec(inputs.get("packing_per_crate")) is None:
            not_included.add("packing cost")

    decision = choose_state(cards, source_error=source_error, any_records=bool(records), any_fresh=any_fresh, config=config)
    state = decision["state"]
    eligible = [c for c in cards if c["eligible"]]
    covers = [c["covers"] for c in eligible if c.get("covers") is not None]
    harvest_message = NO_MARKET_COVERS if covers and not any(covers) and state not in (SOURCE_ERROR, EMPTY) else None
    order_ids = [c["market_id"] for c in decision.get("order", [])]

    return {
        "state": state,
        "message": decision.get("message", MESSAGES.get(state, "")),
        "winner_market_id": decision.get("winner_market_id"),  # only RANKED has a winner
        "lead": decision.get("lead"),
        "tie_band": decision.get("tie_band"),
        "harvest_message": harvest_message,
        "data_label": config["sample_label"] if any(c["is_sample"] for c in cards) else None,
        "cards": sorted(cards, key=lambda c: (order_ids.index(c["market_id"]) if c["market_id"] in order_ids else len(order_ids), not c["eligible"])),
        "not_included": sorted(not_included),
    }
