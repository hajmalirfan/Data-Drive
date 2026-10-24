from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import relationship

from app.core.database import Base


class Market(Base):
    __tablename__ = "markets"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False, index=True)
    district = Column(String(120), nullable=False, default="")
    state = Column(String(120), nullable=False, default="Tamil Nadu")
    latitude = Column(Float, nullable=False, default=0)
    longitude = Column(Float, nullable=False, default=0)
    distance_km = Column(Float, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    prices = relationship("MarketPrice", back_populates="market", cascade="all, delete-orphan")

    @property
    def eta_minutes(self) -> int:
        # Estimated road travel time at an average speed of 35 km/h.
        return max(15, round((self.distance_km / 35.0) * 60))


class CropStock(Base):
    __tablename__ = "crop_stocks"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    crop_name = Column(String(120), nullable=False, index=True)
    variety = Column(String(120), nullable=False, default="")
    quantity_kg = Column(Float, nullable=False)
    unit = Column(String(12), nullable=False, default="kg")
    grade = Column(String(20), nullable=False, default="A")
    harvest_date = Column(Date, nullable=True)
    pickup_location = Column(String(255), nullable=False, default="")
    notes = Column(Text, nullable=False, default="")
    cost_per_kg = Column(Float, nullable=True)
    status = Column(String(24), nullable=False, default="available", server_default="available")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    owner = relationship("User")


class MarketPrice(Base):
    __tablename__ = "market_prices"

    id = Column(Integer, primary_key=True, index=True)
    market_id = Column(Integer, ForeignKey("markets.id", ondelete="CASCADE"), nullable=False, index=True)
    crop_name = Column(String(120), nullable=False, index=True)
    price_per_kg = Column(Float, nullable=False)
    source = Column(String(160), nullable=False, default="")
    observed_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    market = relationship("Market", back_populates="prices")


class Truck(Base):
    __tablename__ = "trucks"

    id = Column(Integer, primary_key=True, index=True)
    operator_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    vehicle_number = Column(String(40), nullable=False, unique=True, index=True)
    truck_type = Column(String(80), nullable=False, default="Open body")
    capacity_kg = Column(Float, nullable=False)
    available_capacity_kg = Column(Float, nullable=False)
    route_from = Column(String(160), nullable=False, default="")
    route_to = Column(String(160), nullable=False, default="")
    available_from = Column(Date, nullable=True)
    price_per_km = Column(Float, nullable=False, default=28)
    base_fare = Column(Float, nullable=False, default=500)
    status = Column(String(24), nullable=False, default="available", server_default="available")
    has_passenger_seat = Column(Boolean, nullable=False, default=False, server_default="0")
    last_location = Column(String(255), nullable=False, default="")
    last_lat = Column(Float, nullable=True)
    last_lng = Column(Float, nullable=True)
    last_reported_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    operator = relationship("User")


class Booking(Base):
    __tablename__ = "bookings"

    id = Column(Integer, primary_key=True, index=True)
    farmer_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    truck_id = Column(Integer, ForeignKey("trucks.id", ondelete="RESTRICT"), nullable=False, index=True)
    crop_id = Column(Integer, ForeignKey("crop_stocks.id", ondelete="SET NULL"), nullable=True)
    market_id = Column(Integer, ForeignKey("markets.id", ondelete="RESTRICT"), nullable=False)
    quantity_kg = Column(Float, nullable=False)
    pickup_location = Column(String(255), nullable=False)
    destination = Column(String(255), nullable=False)
    pickup_at = Column(DateTime(timezone=True), nullable=False)
    accompanied = Column(Boolean, nullable=False, default=False, server_default="0")
    status = Column(String(24), nullable=False, default="requested", server_default="requested")
    distance_km = Column(Float, nullable=False, default=0)
    eta_minutes = Column(Integer, nullable=False, default=0)
    estimated_transport_cost = Column(Float, nullable=False, default=0)
    estimated_net_proceeds = Column(Float, nullable=True)
    notes = Column(Text, nullable=False, default="")
    actual_sold_quantity_kg = Column(Float, nullable=True)
    actual_price_per_kg = Column(Float, nullable=True)
    actual_expenses = Column(Float, nullable=True)
    delivered_at = Column(DateTime(timezone=True), nullable=True)
    location_consent = Column(Boolean, nullable=False, default=False, server_default="0")
    last_lat = Column(Float, nullable=True)
    last_lng = Column(Float, nullable=True)
    last_reported_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    farmer = relationship("User", foreign_keys=[farmer_id])
    truck = relationship("Truck")
    crop = relationship("CropStock")
    market = relationship("Market")


class BookingLocationPoint(Base):
    """One GPS fix shared by the truck operator during a trip (the farmer's live trail)."""

    __tablename__ = "booking_location_points"

    id = Column(Integer, primary_key=True)
    booking_id = Column(Integer, ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False, index=True)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    accuracy_m = Column(Float, nullable=True)
    recorded_at = Column(DateTime(timezone=True), nullable=False, index=True)


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(160), nullable=False)
    message = Column(Text, nullable=False, default="")
    link = Column(String(160), nullable=False, default="")
    is_read = Column(Boolean, nullable=False, default=False, server_default="0")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
