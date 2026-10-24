from sqlalchemy import Column, DateTime, Float, Integer, String, func
from app.core.database import Base

# Valid roles: farmer, marketer, admin, truck_operator, market_manager, buyer
VALID_ROLES = ("farmer", "marketer", "admin", "truck_operator", "market_manager", "buyer")

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(120), nullable=False, default="", server_default="")
    phone = Column(String(20), unique=True, index=True, nullable=True)
    location = Column(String(255), nullable=False, default="", server_default="")
    vehicle_type = Column(String(80), nullable=True)
    vehicle_number = Column(String(40), nullable=True)
    vehicle_capacity_kg = Column(Float, nullable=True)
    role = Column(String(20), nullable=False, default="farmer", server_default="farmer")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # Security policy: lockout after repeated wrong passwords; sessions issued before
    # the last password change are rejected.
    failed_login_attempts = Column(Integer, nullable=True, default=0)
    locked_until = Column(DateTime(timezone=True), nullable=True)
    password_changed_at = Column(DateTime(timezone=True), nullable=True)
