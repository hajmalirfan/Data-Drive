from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Integer, String, func, text

from app.core.database import Base


class AdminLoginOTP(Base):
    """Second-factor codes emailed to admins after a correct password."""

    __tablename__ = "admin_login_otps"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), nullable=False, index=True)
    otp_hash = Column(String(128), nullable=False)
    attempts = Column(Integer, nullable=False, default=0, server_default="0")
    consumed = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=func.now())
    expires_at = Column(DateTime, nullable=False, index=True)
