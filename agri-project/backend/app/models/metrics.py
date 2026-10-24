from sqlalchemy import Column, DateTime, Float, Integer

from app.core.database import Base


class ApiRequestStat(Base):
    """Hourly API request counters (UTC), written by app.core.metrics."""

    __tablename__ = "api_request_stats"

    hour_start = Column(DateTime, primary_key=True)
    requests = Column(Integer, nullable=False, default=0, server_default="0")
    client_errors = Column(Integer, nullable=False, default=0, server_default="0")
    server_errors = Column(Integer, nullable=False, default=0, server_default="0")
    total_ms = Column(Float, nullable=False, default=0, server_default="0")
