from sqlalchemy import Column, DateTime, ForeignKey, Integer, LargeBinary, String, UniqueConstraint, func

from app.core.database import Base

# Documents a truck operator can upload; the licence has a front and back side.
DOCUMENT_TYPES = ("permit", "license_front", "license_back")


class UserDocument(Base):
    """Uploaded document image, stored in the database (one per user and type)."""

    __tablename__ = "user_documents"
    __table_args__ = (UniqueConstraint("user_id", "doc_type", name="uq_user_documents_user_type"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    doc_type = Column(String(30), nullable=False)
    filename = Column(String(255), nullable=False, default="", server_default="")
    content_type = Column(String(50), nullable=False)
    size = Column(Integer, nullable=False)
    data = Column(LargeBinary, nullable=False)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
