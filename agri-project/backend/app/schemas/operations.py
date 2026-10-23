from datetime import date, datetime

from pydantic import BaseModel, Field


# ---------- Crop stock ----------
class CropCreate(BaseModel):
    crop_name: str = Field(min_length=1, max_length=120)
    variety: str = Field(default="", max_length=120)
    quantity_kg: float = Field(gt=0)
    unit: str = Field(default="kg", max_length=12)
    grade: str = Field(default="A", max_length=20)
    harvest_date: date | None = None
    pickup_location: str = Field(min_length=2, max_length=255)
    notes: str = Field(default="", max_length=2000)
    cost_per_kg: float | None = Field(default=None, ge=0)
    status: str = Field(default="available", max_length=24)


class CropUpdate(BaseModel):
    crop_name: str | None = Field(default=None, min_length=1, max_length=120)
    variety: str | None = Field(default=None, max_length=120)
    quantity_kg: float | None = Field(default=None, gt=0)
    unit: str | None = Field(default=None, max_length=12)
    grade: str | None = Field(default=None, max_length=20)
    harvest_date: date | None = None
    pickup_location: str | None = Field(default=None, min_length=2, max_length=255)
    notes: str | None = Field(default=None, max_length=2000)
    cost_per_kg: float | None = Field(default=None, ge=0)
    status: str | None = Field(default=None, max_length=24)


class CropOut(BaseModel):
    id: int
    owner_id: int
    crop_name: str
    variety: str
    quantity_kg: float
    unit: str
    grade: str
    harvest_date: date | None = None
    pickup_location: str
    notes: str = ""
    cost_per_kg: float | None = None
    status: str
    created_at: datetime | None = None

    class Config:
        from_attributes = True


# ---------- Markets and prices ----------
class MarketOut(BaseModel):
    id: int
    name: str
    district: str
    state: str
    latitude: float
    longitude: float
    distance_km: float
    eta_minutes: int

    class Config:
        from_attributes = True


class PriceCreate(BaseModel):
    market_id: int
    crop_name: str = Field(min_length=1, max_length=120)
    price_per_kg: float = Field(gt=0)
    source: str = Field(default="Market price manager", max_length=160)
    observed_at: datetime | None = None


class PriceOut(BaseModel):
    id: int
    market_id: int
    market_name: str
    crop_name: str
    price_per_kg: float
    source: str
    observed_at: datetime
    trend_pct: float | None = None
    is_stale: bool = False


class CostBreakdown(BaseModel):
    saleable_quantity_kg: float
    gross_value: float
    transport_cost: float
    labour_cost: float
    commission: float
    packaging_cost: float
    total_expenses: float
    net_proceeds: float
    estimated_profit: float | None = None
    loss_pct: float


class MarketOption(BaseModel):
    market_id: int
    market_name: str
    district: str
    distance_km: float
    eta_minutes: int
    price_per_kg: float
    source: str
    observed_at: datetime
    is_stale: bool
    breakdown: CostBreakdown


class ComparisonOut(BaseModel):
    crop_name: str
    quantity_kg: float
    cost_per_kg: float | None = None
    options: list[MarketOption]
    recommended_market_id: int | None = None
    assumptions: list[str]


# ---------- Trucks ----------
class TruckCreate(BaseModel):
    vehicle_number: str = Field(min_length=3, max_length=40)
    truck_type: str = Field(default="Open body", max_length=80)
    capacity_kg: float = Field(gt=0)
    available_capacity_kg: float | None = Field(default=None, ge=0)
    route_from: str = Field(default="", max_length=160)
    route_to: str = Field(default="", max_length=160)
    available_from: date | None = None
    price_per_km: float = Field(default=28, ge=0)
    base_fare: float = Field(default=500, ge=0)
    status: str = Field(default="available", max_length=24)
    has_passenger_seat: bool = False
    last_location: str = Field(default="", max_length=255)


class TruckUpdate(BaseModel):
    truck_type: str | None = Field(default=None, max_length=80)
    capacity_kg: float | None = Field(default=None, gt=0)
    available_capacity_kg: float | None = Field(default=None, ge=0)
    route_from: str | None = Field(default=None, max_length=160)
    route_to: str | None = Field(default=None, max_length=160)
    available_from: date | None = None
    price_per_km: float | None = Field(default=None, ge=0)
    base_fare: float | None = Field(default=None, ge=0)
    status: str | None = Field(default=None, max_length=24)
    has_passenger_seat: bool | None = None
    last_location: str | None = Field(default=None, max_length=255)


class TruckOut(BaseModel):
    id: int
    vehicle_number: str
    truck_type: str
    capacity_kg: float
    available_capacity_kg: float
    route_from: str
    route_to: str
    available_from: date | None = None
    price_per_km: float
    base_fare: float
    status: str
    has_passenger_seat: bool
    operator_id: int | None = None
    operator_name: str = ""
    operator_phone: str = ""
    operator_location: str = ""
    last_location: str = ""
    last_lat: float | None = None
    last_lng: float | None = None
    last_reported_at: datetime | None = None


# ---------- Bookings ----------
class BookingCreate(BaseModel):
    truck_id: int
    crop_id: int | None = None
    market_id: int
    quantity_kg: float = Field(gt=0)
    pickup_location: str = Field(min_length=2, max_length=255)
    destination: str = Field(min_length=2, max_length=255)
    pickup_at: datetime
    accompanied: bool = False
    notes: str = Field(default="", max_length=2000)


class BookingStatusUpdate(BaseModel):
    status: str = Field(min_length=1, max_length=24)
    note: str = Field(default="", max_length=500)


class BookingDeliveryUpdate(BaseModel):
    actual_sold_quantity_kg: float = Field(ge=0)
    actual_price_per_kg: float = Field(ge=0)
    actual_expenses: float = Field(default=0, ge=0)


class BookingLocationUpdate(BaseModel):
    lat: float
    lng: float
    location: str = Field(default="", max_length=255)
    consent: bool = True


class BookingOut(BaseModel):
    id: int
    farmer_id: int
    farmer_name: str
    truck_id: int
    vehicle_number: str
    truck_type: str
    crop_id: int | None = None
    crop_name: str = ""
    market_id: int
    market_name: str
    quantity_kg: float
    pickup_location: str
    destination: str
    pickup_at: datetime
    accompanied: bool
    status: str
    distance_km: float
    eta_minutes: int
    estimated_transport_cost: float
    estimated_net_proceeds: float | None = None
    notes: str = ""
    actual_sold_quantity_kg: float | None = None
    actual_price_per_kg: float | None = None
    actual_expenses: float | None = None
    delivered_at: datetime | None = None
    location_consent: bool
    last_lat: float | None = None
    last_lng: float | None = None
    last_reported_at: datetime | None = None
    created_at: datetime | None = None


# ---------- Notifications ----------
class NotificationOut(BaseModel):
    id: int
    title: str
    message: str
    link: str = ""
    is_read: bool
    created_at: datetime | None = None

    class Config:
        from_attributes = True
