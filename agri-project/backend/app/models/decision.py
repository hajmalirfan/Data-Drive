"""Tables for the guest selling-decision flow (PRD v4.2 section 6).

Kept apart from ``markets``/``market_prices`` (bookings depend on those) and from
``mandi_prices`` (the government board). Every place-specific fact lives in rows:
a new district or crop is added by inserting rows, not by changing code.
"""
from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import relationship

from app.core.database import Base

MARKET_TYPES = ("wholesale", "uzhavar_sandhai", "unknown")


class Region(Base):
    __tablename__ = "regions"

    id = Column(Integer, primary_key=True)
    name = Column(String(120), nullable=False)  # district
    state = Column(String(120), nullable=False)

    __table_args__ = (UniqueConstraint("name", "state", name="uq_regions_name_state"),)


class DecisionMarket(Base):
    """A market the comparison may offer. ``enabled`` is switched on once it has fresh, comparable prices."""

    __tablename__ = "decision_markets"

    id = Column(Integer, primary_key=True)
    slug = Column(String(60), unique=True, nullable=False, index=True)
    name = Column(String(160), nullable=False)
    region_id = Column(Integer, ForeignKey("regions.id"), nullable=False)
    market_type = Column(String(30), nullable=False, default="unknown")
    enabled = Column(Boolean, nullable=False, default=False)

    region = relationship("Region")


class MarketCrop(Base):
    """A configured crop-market pair: the comparison offers only these (FR-02)."""

    __tablename__ = "decision_market_crops"

    market_id = Column(Integer, ForeignKey("decision_markets.id"), primary_key=True)
    crop = Column(String(60), primary_key=True)


class UnitConversion(Base):
    __tablename__ = "unit_conversions"

    unit = Column(String(30), primary_key=True)
    kg_per_unit = Column(Numeric(12, 4), nullable=False)


class IngestionRun(Base):
    __tablename__ = "ingestion_runs"

    id = Column(Integer, primary_key=True)
    source_name = Column(String(120), nullable=False)
    data_mode = Column(String(20), nullable=False)  # sample | snapshot
    status = Column(String(20), nullable=False)  # SUCCESS | EMPTY | ERROR
    rows_loaded = Column(Integer, nullable=False, default=0)
    note = Column(String(500))
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    finished_at = Column(DateTime(timezone=True))


class PriceRecord(Base):
    __tablename__ = "price_records"

    id = Column(Integer, primary_key=True)
    market_id = Column(Integer, ForeignKey("decision_markets.id"), nullable=False, index=True)
    crop = Column(String(60), nullable=False, index=True)
    variety = Column(String(80), nullable=False, default="")
    grade = Column(String(80), nullable=False, default="")
    report_date = Column(Date)
    min_price = Column(Numeric(12, 2))
    max_price = Column(Numeric(12, 2))
    modal_price = Column(Numeric(12, 2))
    unit = Column(String(30))  # as published; may be an unconvertible unit such as "box"
    source_name = Column(String(120))
    is_sample = Column(Boolean, nullable=False, default=False)
    run_id = Column(Integer, ForeignKey("ingestion_runs.id"), nullable=False)
    raw_ref = Column(String(255))

    market = relationship("DecisionMarket")
    run = relationship("IngestionRun")

    __table_args__ = (
        UniqueConstraint(
            "market_id", "crop", "report_date", "variety", "grade", "source_name",
            name="uq_price_records_identity",
        ),
    )
