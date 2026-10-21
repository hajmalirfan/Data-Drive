from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.operations import Booking, CropStock
from app.models.user import User
from app.routers.auth import get_current_user, require_farmer
from app.schemas.operations import CropCreate, CropOut, CropUpdate

router = APIRouter(prefix="/api/crops", tags=["crops"])

CROP_STATUSES = {"draft", "available", "reserved", "partially_sold", "sold", "closed"}
ACTIVE_BOOKING_STATUSES = {"requested", "accepted", "assigned", "picked_up", "in_transit"}


def _get_crop(db: Session, crop_id: int, user: User) -> CropStock:
    crop = db.query(CropStock).filter(CropStock.id == crop_id).first()
    if not crop:
        raise HTTPException(status_code=404, detail="Crop stock not found")
    if user.role != "admin" and crop.owner_id != user.id:
        raise HTTPException(status_code=403, detail="You can only manage your own crop stock")
    return crop


def _assert_not_locked(db: Session, crop_id: int) -> None:
    booking = (
        db.query(Booking)
        .filter(
            Booking.crop_id == crop_id,
            Booking.status.in_(ACTIVE_BOOKING_STATUSES),
        )
        .first()
    )
    if booking:
        raise HTTPException(
            status_code=409,
            detail="This crop stock is locked by an active truck booking",
        )


@router.get("", response_model=list[CropOut])
def list_crops(
    status_filter: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(CropStock)
    if user.role != "admin":
        query = query.filter(CropStock.owner_id == user.id)
    if status_filter:
        query = query.filter(CropStock.status == status_filter)
    return query.order_by(CropStock.created_at.desc(), CropStock.id.desc()).all()


@router.post("", response_model=CropOut, status_code=201)
def create_crop(
    data: CropCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_farmer),
):
    crop_status = (data.status or "available").lower()
    if crop_status not in CROP_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid crop status. Choose from: {', '.join(sorted(CROP_STATUSES))}",
        )
    crop = CropStock(
        owner_id=user.id,
        crop_name=data.crop_name.strip(),
        variety=data.variety.strip(),
        quantity_kg=data.quantity_kg,
        unit=data.unit.strip() or "kg",
        grade=data.grade.strip() or "A",
        harvest_date=data.harvest_date,
        pickup_location=data.pickup_location.strip(),
        notes=data.notes.strip(),
        cost_per_kg=data.cost_per_kg,
        status=crop_status,
    )
    db.add(crop)
    db.commit()
    db.refresh(crop)
    return crop


@router.patch("/{crop_id}", response_model=CropOut)
def update_crop(
    crop_id: int,
    data: CropUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    crop = _get_crop(db, crop_id, user)
    _assert_not_locked(db, crop_id)

    updates = data.model_dump(exclude_unset=True)
    if "status" in updates and updates["status"]:
        updates["status"] = updates["status"].lower()
        if updates["status"] not in CROP_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid crop status. Choose from: {', '.join(sorted(CROP_STATUSES))}",
            )
    for field, value in updates.items():
        if isinstance(value, str):
            value = value.strip()
        setattr(crop, field, value)
    db.commit()
    db.refresh(crop)
    return crop


@router.delete("/{crop_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_crop(
    crop_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    crop = _get_crop(db, crop_id, user)
    _assert_not_locked(db, crop_id)
    db.delete(crop)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
