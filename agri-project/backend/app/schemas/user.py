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
    password: str = Field(min_length=1, max_length=128)  # strength rules: security_policy
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=20)
    location: str | None = Field(default=None, max_length=255)
    role: UserRole = "farmer"

class UserLogin(BaseModel):
    identifier: str | None = Field(default=None, max_length=255)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=20)
    password: str = Field(max_length=256)

class UserOut(BaseModel):
    id: int
    email: str
    full_name: str = ""
    phone: str | None = None
    location: str = ""
    vehicle_type: str | None = None
    vehicle_number: str | None = None
    vehicle_capacity_kg: float | None = None
    role: UserRole = "farmer"

    class Config:
        from_attributes = True

class UserProfileUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    phone: str | None = Field(default=None, max_length=20)
    location: str | None = Field(default=None, max_length=255)
    vehicle_type: str | None = Field(default=None, max_length=80)
    vehicle_number: str | None = Field(default=None, max_length=40)
    vehicle_capacity_kg: float | None = Field(default=None, gt=0)

class UserRoleUpdate(BaseModel):
    role: UserRole

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut

class LoginResponse(BaseModel):
    """Either a session (access_token + user) or, for admins, an OTP challenge."""
    access_token: str | None = None
    token_type: str = "bearer"
    user: UserOut | None = None
    otp_required: bool = False
    login_token: str | None = None
    otp_email: str | None = None
    expires_in: int | None = None
    resend_in: int | None = None
    # Only populated when no email provider is configured (local development).
    debug_otp: str | None = None

class AdminOtpVerifyRequest(BaseModel):
    login_token: str = Field(min_length=10)
    otp: str = Field(min_length=4, max_length=8, pattern=r"^\d{4,8}$")

class AdminOtpResendRequest(BaseModel):
    login_token: str = Field(min_length=10)

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class VerifyOtpRequest(BaseModel):
    email: EmailStr
    otp: str = Field(min_length=4, max_length=8, pattern=r"^\d{4,8}$")

class ResetPasswordRequest(BaseModel):
    reset_token: str = Field(min_length=10)
    new_password: str = Field(min_length=1, max_length=128)  # strength rules: security_policy

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
