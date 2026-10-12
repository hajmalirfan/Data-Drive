from sqlalchemy import Column, Integer, String, DateTime, func
from app.core.database import Base

# Valid roles: farmer, fpo, marketer, admin
VALID_ROLES = ("farmer", "fpo", "marketer", "admin")

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False, default="farmer", server_default="farmer")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
