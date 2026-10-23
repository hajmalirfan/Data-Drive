from typing import Literal

from pydantic import BaseModel, EmailStr, Field

# Role type: farmer | marketer | admin | truck_operator | market_manager | buyer
UserRole = Literal[
    "farmer",
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

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class VerifyOtpRequest(BaseModel):
    email: EmailStr
    otp: str = Field(min_length=4, max_length=8, pattern=r"^\d{4,8}$")

class ResetPasswordRequest(BaseModel):
    reset_token: str = Field(min_length=10)
    new_password: str = Field(min_length=6, max_length=128)

class ForgotPasswordResponse(BaseModel):
    message: str
    expires_in: int
    resend_in: int
    # Only populated when SMTP is not configured (local development).
    debug_otp: str | None = None

class VerifyOtpResponse(BaseModel):
    message: str
    reset_token: str

class MessageResponse(BaseModel):
    message: str
