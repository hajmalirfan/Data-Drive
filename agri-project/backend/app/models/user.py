from sqlalchemy import Column, Integer, String, DateTime, func
from app.core.database import Base

# Valid roles: farmer, fpo, marketer, admin, truck_operator, market_manager, buyer
VALID_ROLES = ("farmer", "fpo", "marketer", "admin", "truck_operator", "market_manager", "buyer")

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(120), nullable=False, default="", server_default="")
    phone = Column(String(20), unique=True, index=True, nullable=True)
    location = Column(String(255), nullable=False, default="", server_default="")
    role = Column(String(20), nullable=False, default="farmer", server_default="farmer")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
