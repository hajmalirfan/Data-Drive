from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.operations import Booking, Truck
from app.models.user import User
from app.routers.auth import get_current_user, require_truck_operator
from app.schemas.operations import TruckCreate, TruckOut, TruckUpdate

router = APIRouter(prefix="/api/trucks", tags=["trucks"])

TRUCK_STATUSES = {"available", "reserved", "on_trip", "maintenance", "inactive"}


def truck_out(truck: Truck, include_gps: bool = False) -> TruckOut:
    return TruckOut(
        id=truck.id,
        vehicle_number=truck.vehicle_number,
        truck_type=truck.truck_type,
        capacity_kg=truck.capacity_kg,
        available_capacity_kg=truck.available_capacity_kg,
        route_from=truck.route_from,
        route_to=truck.route_to,
        available_from=truck.available_from,
        price_per_km=truck.price_per_km,
        base_fare=truck.base_fare,
        status=truck.status,
        has_passenger_seat=truck.has_passenger_seat,
        operator_id=truck.operator_id,
        operator_name=truck.operator.full_name if truck.operator else "",
        operator_phone=(truck.operator.phone or "") if truck.operator else "",
        operator_location=(truck.operator.location or "") if truck.operator else "",
        last_location=truck.last_location,
        last_lat=truck.last_lat if include_gps else None,
        last_lng=truck.last_lng if include_gps else None,
        last_reported_at=truck.last_reported_at if include_gps else None,
    )


def _get_truck(db: Session, truck_id: int, user: User) -> Truck:
    truck = db.query(Truck).filter(Truck.id == truck_id).first()
    if not truck:
        raise HTTPException(status_code=404, detail="Truck not found")
    if user.role != "admin" and truck.operator_id != user.id:
        raise HTTPException(status_code=403, detail="You can only manage your own trucks")
    return truck


@router.get("", response_model=list[TruckOut])
def list_trucks(
    status_filter: str | None = Query(default=None, alias="status"),
    min_capacity_kg: float | None = Query(default=None, gt=0),
    q: str | None = Query(default=None, max_length=120),
    mine: bool = Query(default=False),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(Truck)
    if status_filter:
        query = query.filter(Truck.status == status_filter)
    if min_capacity_kg:
        query = query.filter(Truck.available_capacity_kg >= min_capacity_kg)
    if mine:
        query = query.filter(Truck.operator_id == user.id)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            Truck.vehicle_number.ilike(like)
            | Truck.truck_type.ilike(like)
            | Truck.route_from.ilike(like)
            | Truck.route_to.ilike(like)
        )
    return [
        truck_out(truck, user.role == "admin" or truck.operator_id == user.id)
        for truck in query.order_by(Truck.vehicle_number.asc()).all()
    ]


@router.get("/{truck_id}", response_model=TruckOut)
def get_truck(
    truck_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    truck = db.query(Truck).filter(Truck.id == truck_id).first()
    if not truck:
        raise HTTPException(status_code=404, detail="Truck not found")
    return truck_out(truck, user.role == "admin" or truck.operator_id == user.id)


@router.post("", response_model=TruckOut, status_code=201)
def create_truck(
    data: TruckCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_truck_operator),
):
    if db.query(Truck).filter(Truck.vehicle_number == data.vehicle_number.strip()).first():
        raise HTTPException(status_code=400, detail="A truck with this vehicle number already exists")
    status_value = (data.status or "available").lower()
    if status_value not in TRUCK_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid truck status. Choose from: {', '.join(sorted(TRUCK_STATUSES))}",
        )
    truck = Truck(
        operator_id=user.id,
        vehicle_number=data.vehicle_number.strip(),
        truck_type=data.truck_type.strip(),
        capacity_kg=data.capacity_kg,
        available_capacity_kg=(
            data.available_capacity_kg if data.available_capacity_kg is not None else data.capacity_kg
        ),
        route_from=data.route_from.strip(),
        route_to=data.route_to.strip(),
        available_from=data.available_from,
        price_per_km=data.price_per_km,
        base_fare=data.base_fare,
        status=status_value,
        has_passenger_seat=data.has_passenger_seat,
        last_location=data.last_location.strip(),
    )
    db.add(truck)
    db.commit()
    db.refresh(truck)
    return truck_out(truck, True)


@router.delete("/{truck_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_truck(
    truck_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    truck = _get_truck(db, truck_id, user)
    has_bookings = db.query(Booking.id).filter(Booking.truck_id == truck.id).first()
    if has_bookings:
        truck.status = "inactive"
    else:
        db.delete(truck)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{truck_id}", response_model=TruckOut)
def update_truck(
    truck_id: int,
    data: TruckUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    truck = _get_truck(db, truck_id, user)
    updates = data.model_dump(exclude_unset=True)
    if "status" in updates and updates["status"]:
        updates["status"] = updates["status"].lower()
        if updates["status"] not in TRUCK_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid truck status. Choose from: {', '.join(sorted(TRUCK_STATUSES))}",
            )
    for field, value in updates.items():
        if isinstance(value, str):
            value = value.strip()
        setattr(truck, field, value)
    db.commit()
    db.refresh(truck)
    return truck_out(truck, True)
