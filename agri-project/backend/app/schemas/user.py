from pydantic import BaseModel, EmailStr
from typing import Literal

# Role type: farmer | fpo | marketer | admin
UserRole = Literal["farmer", "fpo", "marketer", "admin"]

class UserSignup(BaseModel):
    email: EmailStr
    password: str
    role: UserRole = "farmer"

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserOut(BaseModel):
    id: int
    email: EmailStr
    role: UserRole = "farmer"

    class Config:
        from_attributes = True

class UserRoleUpdate(BaseModel):
    role: UserRole

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
