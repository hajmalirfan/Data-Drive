from sqlalchemy import Column, Date, DateTime, Float, Index, Integer, String, Text, UniqueConstraint, func

from app.core.database import Base


class MandiPrice(Base):
    """Daily mandi price exactly as published on data.gov.in (Agmarknet).

    Prices are rupees per quintal (100 kg), as in the source. Nothing is
    estimated: rows are only inserted or refreshed from the government feed.
    """

    __tablename__ = "mandi_prices"
    __table_args__ = (
        UniqueConstraint(
            "state", "district", "market", "commodity", "variety", "grade", "arrival_date",
            name="uq_mandi_prices_record",
        ),
        Index("ix_mandi_prices_date_commodity", "arrival_date", "commodity"),
        Index("ix_mandi_prices_state_district", "state", "district"),
    )

    id = Column(Integer, primary_key=True)
    state = Column(String(80), nullable=False)
    district = Column(String(120), nullable=False)
    market = Column(String(160), nullable=False)
    commodity = Column(String(120), nullable=False)
    variety = Column(String(120), nullable=False, default="", server_default="")
    grade = Column(String(60), nullable=False, default="", server_default="")
    arrival_date = Column(Date, nullable=False, index=True)
    min_price = Column(Float, nullable=True)
    max_price = Column(Float, nullable=True)
    modal_price = Column(Float, nullable=True)
    fetched_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class MandiSyncRun(Base):
    """One attempt to download the government feed (shown to admins)."""

    __tablename__ = "mandi_sync_runs"

    id = Column(Integer, primary_key=True)
    started_at = Column(DateTime(timezone=True), nullable=False)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String(20), nullable=False, default="running")  # running | success | failed
    records = Column(Integer, nullable=False, default=0)
    source_total = Column(Integer, nullable=True)
    latest_arrival_date = Column(Date, nullable=True)
    error = Column(Text, nullable=True)
