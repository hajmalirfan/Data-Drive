from sqlalchemy import Column, DateTime, Float, Integer, String, UniqueConstraint, func

from app.core.database import Base


class GeocodeCache(Base):
    """OpenStreetMap (Nominatim) lookups, cached so each place is looked up once.

    latitude/longitude are NULL when the place was not found (so it is not retried
    on every request).
    """

    __tablename__ = "geocode_cache"

    query = Column(String(300), primary_key=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    display_name = Column(String(500), nullable=True)
    looked_up_at = Column(DateTime(timezone=True), server_default=func.now())


class RouteCache(Base):
    """Road distance and drive time from OSRM between two rounded points."""

    __tablename__ = "route_cache"
    __table_args__ = (UniqueConstraint("origin_key", "dest_key", name="uq_route_cache_pair"),)

    id = Column(Integer, primary_key=True)
    origin_key = Column(String(40), nullable=False)
    dest_key = Column(String(40), nullable=False)
    distance_km = Column(Float, nullable=False)
    duration_min = Column(Float, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
