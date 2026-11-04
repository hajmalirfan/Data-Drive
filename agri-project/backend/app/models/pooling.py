"""Shared truck trips: farmers going to the same market share one truck and split its fare."""
from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import backref, relationship

from app.core.database import Base


class SharedTrip(Base):
    __tablename__ = "shared_trips"

    id = Column(Integer, primary_key=True, index=True)
    truck_id = Column(Integer, ForeignKey("trucks.id", ondelete="RESTRICT"), nullable=False, index=True)
    market_id = Column(Integer, ForeignKey("markets.id", ondelete="RESTRICT"), nullable=False)
    opener_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    pickup_point = Column(String(255), nullable=False)
    pickup_at = Column(DateTime(timezone=True), nullable=False)
    # Fixed when the trip opens, so later price changes do not move anyone's share.
    trip_fare = Column(Float, nullable=False)
    status = Column(String(16), nullable=False, default="open", server_default="open")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    closed_at = Column(DateTime(timezone=True), nullable=True)

    truck = relationship("Truck")
    market = relationship("Market")
    opener = relationship("User")
    members = relationship(
        "SharedTripMember",
        back_populates="trip",
        cascade="all, delete-orphan",
        order_by="SharedTripMember.id",
    )


class SharedTripMember(Base):
    __tablename__ = "shared_trip_members"

    id = Column(Integer, primary_key=True, index=True)
    trip_id = Column(Integer, ForeignKey("shared_trips.id", ondelete="CASCADE"), nullable=False, index=True)
    # A booking belongs to at most one trip.
    booking_id = Column(Integer, ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False, unique=True)
    joined_at = Column(DateTime(timezone=True), server_default=func.now())

    trip = relationship("SharedTrip", back_populates="members")
    booking = relationship("Booking", backref=backref("trip_membership", uselist=False))
