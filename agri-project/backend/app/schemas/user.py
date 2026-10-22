from typing import Literal

from pydantic import BaseModel, EmailStr, Field

# Role type: farmer | fpo | marketer | admin | truck_operator | market_manager | buyer
UserRole = Literal[
    "farmer",
    "fpo",
    "marketer",
    "admin",
    "truck_operator",
    "market_manager",
    "buyer",
]

class UserSignup(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=6, max_length=128)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=20)
    location: str | None = Field(default=None, max_length=255)
    role: UserRole = "farmer"

class UserLogin(BaseModel):
    identifier: str | None = Field(default=None, max_length=255)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=20)
    password: str

class UserOut(BaseModel):
    id: int
    email: str
    full_name: str = ""
    phone: str | None = None
    location: str = ""
    role: UserRole = "farmer"

    class Config:
        from_attributes = True

class UserProfileUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    phone: str | None = Field(default=None, max_length=20)
    location: str | None = Field(default=None, max_length=255)

class UserRoleUpdate(BaseModel):
    role: UserRole

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
