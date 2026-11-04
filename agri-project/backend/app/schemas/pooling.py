from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.operations import BookingCreate, BookingOut


class SharedTripOpen(BookingCreate):
    pickup_point: str = Field(min_length=2, max_length=255)


class SharedTripJoin(BaseModel):
    quantity_kg: float = Field(gt=0)
    crop_id: int | None = None
    notes: str = Field(default="", max_length=2000)


class SharedTripSummary(BaseModel):
    id: int
    market_id: int
    market_name: str
    pickup_point: str
    pickup_at: datetime
    truck_type: str
    capacity_kg: float
    kg_booked: float
    kg_free: float
    member_count: int
    trip_fare: float
    status: str
    is_member: bool


class SharedTripQuote(BaseModel):
    share: float
    alone: float
    saving: float


class SharedTripMemberOut(BaseModel):
    booking_id: int
    first_name: str
    quantity_kg: float
    status: str
    share: float


class SharedTripDetail(SharedTripSummary):
    opener_id: int | None
    members: list[SharedTripMemberOut]


class SharedTripOpened(BaseModel):
    trip: SharedTripDetail
    booking: BookingOut
