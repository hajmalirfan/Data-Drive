from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session, defer

from app.core.database import get_db
from app.models.user import User
from app.models.user_document import DOCUMENT_TYPES, UserDocument
from app.routers.auth import get_current_user, require_admin

router = APIRouter(prefix="/api/auth", tags=["documents"])

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_DOCUMENT_BYTES = 5 * 1024 * 1024
# Magic bytes, so a renamed non-image file is rejected even if the browser lies about its type.
SIGNATURES = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/webp": (b"RIFF",),
}


class DocumentOut(BaseModel):
    doc_type: str
    filename: str
    content_type: str
    size: int
    uploaded_at: datetime | None = None

    class Config:
        from_attributes = True


def check_doc_type(doc_type: str) -> str:
    if doc_type not in DOCUMENT_TYPES:
        raise HTTPException(status_code=404, detail="Unknown document type")
    return doc_type


def require_document_owner(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in ("truck_operator", "admin"):
        raise HTTPException(status_code=403, detail="Only truck operators can upload documents")
    return current_user


def list_for(user_id: int, db: Session) -> list[UserDocument]:
    # Defer the image bytes; the list only needs metadata.
    return (
        db.query(UserDocument)
        .options(defer(UserDocument.data))
        .filter(UserDocument.user_id == user_id)
        .order_by(UserDocument.doc_type)
        .all()
    )


def image_response(user_id: int, doc_type: str, db: Session) -> Response:
    doc = (
        db.query(UserDocument)
        .filter(UserDocument.user_id == user_id, UserDocument.doc_type == check_doc_type(doc_type))
        .first()
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not uploaded")
    return Response(content=doc.data, media_type=doc.content_type, headers={"Cache-Control": "private, no-store"})


@router.get("/me/documents", response_model=List[DocumentOut])
def my_documents(db: Session = Depends(get_db), user: User = Depends(require_document_owner)):
    return list_for(user.id, db)


@router.get("/me/documents/{doc_type}")
def my_document_image(doc_type: str, db: Session = Depends(get_db), user: User = Depends(require_document_owner)):
    return image_response(user.id, doc_type, db)


@router.put("/me/documents/{doc_type}", response_model=DocumentOut)
async def upload_document(
    doc_type: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_document_owner),
):
    check_doc_type(doc_type)
    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Upload a JPG, PNG or WebP image")
    data = await file.read(MAX_DOCUMENT_BYTES + 1)
    if not data:
        raise HTTPException(status_code=400, detail="The file is empty")
    if len(data) > MAX_DOCUMENT_BYTES:
        raise HTTPException(status_code=413, detail="Image must be 5 MB or smaller")
    if not data.startswith(SIGNATURES[content_type]) or (content_type == "image/webp" and data[8:12] != b"WEBP"):
        raise HTTPException(status_code=400, detail="This file is not a valid image")

    doc = (
        db.query(UserDocument)
        .filter(UserDocument.user_id == user.id, UserDocument.doc_type == doc_type)
        .first()
    )
    if doc is None:
        doc = UserDocument(user_id=user.id, doc_type=doc_type)
        db.add(doc)
    doc.filename = (file.filename or "")[:255]
    doc.content_type = content_type
    doc.size = len(data)
    doc.data = data
    doc.uploaded_at = datetime.utcnow()
    db.commit()
    db.refresh(doc)
    return doc


@router.delete("/me/documents/{doc_type}", status_code=204)
def delete_document(doc_type: str, db: Session = Depends(get_db), user: User = Depends(require_document_owner)):
    db.query(UserDocument).filter(
        UserDocument.user_id == user.id, UserDocument.doc_type == check_doc_type(doc_type)
    ).delete(synchronize_session=False)
    db.commit()
    return Response(status_code=204)


# ---- Admin: review a user's documents ----
@router.get("/users/{user_id}/documents", response_model=List[DocumentOut])
def user_documents(user_id: int, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    return list_for(user_id, db)


@router.get("/users/{user_id}/documents/{doc_type}")
def user_document_image(user_id: int, doc_type: str, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    return image_response(user_id, doc_type, db)
