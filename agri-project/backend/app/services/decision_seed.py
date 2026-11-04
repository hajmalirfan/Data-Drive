"""Sample seed for the guest comparison (PRD v4.2 section 6).

Eight labelled sample records near Oddanchatram, one per result the demo must
show. Market names and types are still to be confirmed by the BA. Where the PRD
gives no figure (min/max, and the prices of the excluded markets) the value is a
placeholder chosen only to trigger the intended exclusion; every row is stored
with ``is_sample=True`` and source "Sample", so it is never shown as reported.
"""
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.decision import DecisionMarket, IngestionRun, MarketCrop, PriceRecord, Region, UnitConversion

SAMPLE_SOURCE = "Sample"
OCT24, OCT23, OCT21 = date(2026, 10, 24), date(2026, 10, 23), date(2026, 10, 21)

UNITS = {"kg": "1", "quintal": "100", "tonne": "1000", "crate": "14"}

# slug, name, market_type, modal, unit, report_date, min, max  (min/max None = same as modal)
SAMPLE_PRICES = [
    ("oddanchatram", "Oddanchatram", "wholesale", "120", "crate", OCT24, None, None),
    ("dindigul", "Dindigul", "wholesale", "1050", "quintal", OCT24, None, None),
    ("palani", "Palani", "wholesale", "150", "crate", OCT24, None, None),
    ("dindigul-uzhavar-sandhai", "Dindigul Uzhavar Sandhai", "uzhavar_sandhai", "13", "kg", OCT24, None, None),
    ("vedasandur", "Vedasandur", "wholesale", "125", "crate", OCT23, None, None),  # different date
    ("batlagundu", "Batlagundu", "wholesale", "130", "crate", OCT21, None, None),  # stale
    ("nilakottai", "Nilakottai", "wholesale", "140", "box", OCT24, None, None),  # unit unclear
    ("natham", "Natham", "wholesale", "130", "crate", OCT24, "100", "120"),  # modal above max
]


def seed_units(db: Session) -> None:
    for unit, kg in UNITS.items():
        if db.get(UnitConversion, unit) is None:
            db.add(UnitConversion(unit=unit, kg_per_unit=Decimal(kg)))


def seed_sample(db: Session) -> int:
    """Insert the sample region, markets and prices if missing. Returns the number of price rows added."""
    seed_units(db)
    region = db.query(Region).filter_by(name="Dindigul", state="Tamil Nadu").first()
    if region is None:
        region = Region(name="Dindigul", state="Tamil Nadu")
        db.add(region)
        db.flush()

    if db.query(PriceRecord).filter_by(is_sample=True).first() is not None:
        db.commit()
        return 0

    run = IngestionRun(source_name=SAMPLE_SOURCE, data_mode="sample", status="SUCCESS", note="PRD v4.2 sample seed")
    db.add(run)
    db.flush()

    for slug, name, market_type, modal, unit, report_date, low, high in SAMPLE_PRICES:
        market = db.query(DecisionMarket).filter_by(slug=slug).first()
        if market is None:
            market = DecisionMarket(slug=slug, name=name, region_id=region.id, market_type=market_type, enabled=True)
            db.add(market)
            db.flush()
        if db.get(MarketCrop, (market.id, "tomato")) is None:
            db.add(MarketCrop(market_id=market.id, crop="tomato"))
        db.add(PriceRecord(
            market_id=market.id, crop="tomato", report_date=report_date,
            min_price=Decimal(low or modal), max_price=Decimal(high or modal), modal_price=Decimal(modal),
            unit=unit, source_name=SAMPLE_SOURCE, is_sample=True, run_id=run.id, raw_ref=f"sample:{slug}",
        ))

    run.rows_loaded = len(SAMPLE_PRICES)
    run.finished_at = datetime.now(timezone.utc)
    db.commit()
    return len(SAMPLE_PRICES)
