import math
import re
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from typing import List
from app.core.config import settings
from app.core.database import get_db
from app.core.email import send_password_reset_email, email_configured
from app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    decode_token,
    generate_otp,
    hash_otp,
    otp_matches,
)
from app.models.password_reset import PasswordResetOTP
from app.models.user import User, VALID_ROLES
from app.schemas.user import (
    UserSignup,
    UserLogin,
    TokenResponse,
    UserOut,
    UserProfileUpdate,
    UserRoleUpdate,
    ForgotPasswordRequest,
    VerifyOtpRequest,
    ResetPasswordRequest,
    ForgotPasswordResponse,
    VerifyOtpResponse,
    MessageResponse,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    payload = decode_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = db.query(User).filter(User.email == payload["sub"]).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    # Backfill role for old rows created before roles existed
    if not getattr(user, "role", None):
        user.role = "farmer"
    return user


def require_roles(*allowed_roles: str):
    """Dependency factory: only allow users whose role is in allowed_roles."""
    def checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=403,
                detail=f"Access denied. Required role: {'/'.join(allowed_roles)}. Your role: {current_user.role}",
            )
        return current_user
    return checker


# Convenience dependencies
require_admin = require_roles("admin")
require_marketer = require_roles("marketer", "admin")
require_farmer = require_roles("farmer", "marketer", "admin")
require_truck_operator = require_roles("truck_operator", "admin")
require_price_manager = require_roles("market_manager", "admin")


def normalize_phone(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = re.sub(r"[\s\-()]", "", value.strip())
    if not cleaned:
        return None
    if not re.fullmatch(r"\+?\d{7,15}", cleaned):
        raise HTTPException(status_code=400, detail="Enter a valid mobile number")
    return cleaned


@router.post("/signup", response_model=TokenResponse, status_code=201)
def signup(data: UserSignup, db: Session = Depends(get_db)):
    role = (data.role or "farmer").lower().strip()
    if role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role. Choose from: {', '.join(VALID_ROLES)}")
    if len(data.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    phone = normalize_phone(data.phone)
    email = data.email.lower().strip() if data.email else None
    if not email and not phone:
        raise HTTPException(status_code=400, detail="Email or mobile number is required")
    if not email and phone:
        # Keep a stable unique email for accounts that sign up with mobile only.
        email = f"{phone.lstrip('+')}@phone.smartag.local"

    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=400, detail="Email already registered. Please Sign In.")
    if phone and db.query(User).filter(User.phone == phone).first():
        raise HTTPException(status_code=400, detail="Mobile number already registered. Please Sign In.")

    user = User(
        email=email,
        phone=phone,
        full_name=data.full_name.strip(),
        location=(data.location or "").strip(),
        hashed_password=hash_password(data.password),
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token({"sub": user.email, "role": user.role})
    return {"access_token": token, "token_type": "bearer", "user": user}

@router.post("/login", response_model=TokenResponse)
def login(data: UserLogin, db: Session = Depends(get_db)):
    identifier = (data.identifier or data.email or data.phone or "").strip()
    if not identifier:
        raise HTTPException(status_code=400, detail="Email or mobile number is required")

    if "@" in identifier:
        user = db.query(User).filter(User.email == identifier.lower()).first()
    else:
        phone = normalize_phone(identifier)
        user = db.query(User).filter(User.phone == phone).first()

    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not getattr(user, "role", None):
        user.role = "farmer"
        db.commit()
        db.refresh(user)
    token = create_access_token({"sub": user.email, "role": user.role})
    return {"access_token": token, "token_type": "bearer", "user": user}

@router.post("/forgot-password", response_model=ForgotPasswordResponse)
def forgot_password(data: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """Send a one-time code to the account email for password reset."""
    email = data.email.lower().strip()
    now = datetime.utcnow()

    # Housekeeping: remove OTP rows that expired more than a day ago.
    db.query(PasswordResetOTP).filter(
        PasswordResetOTP.expires_at < now - timedelta(days=1)
    ).delete(synchronize_session=False)

    latest = (
        db.query(PasswordResetOTP)
        .filter(
            PasswordResetOTP.email == email,
            PasswordResetOTP.consumed.is_(False),
            PasswordResetOTP.expires_at > now,
        )
        .order_by(PasswordResetOTP.created_at.desc(), PasswordResetOTP.id.desc())
        .first()
    )
    if latest and latest.created_at:
        elapsed = (now - latest.created_at).total_seconds()
        if elapsed < settings.OTP_RESEND_SECONDS:
            wait = max(1, math.ceil(settings.OTP_RESEND_SECONDS - elapsed))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Please wait {wait} seconds before requesting a new code.",
            )

    # Invalidate any older unused codes for this email.
    db.query(PasswordResetOTP).filter(
        PasswordResetOTP.email == email,
        PasswordResetOTP.consumed.is_(False),
    ).update({PasswordResetOTP.consumed: True}, synchronize_session=False)

    otp = generate_otp()
    record = PasswordResetOTP(
        email=email,
        otp_hash=hash_otp(email, otp),
        expires_at=now + timedelta(minutes=settings.OTP_EXPIRE_MINUTES),
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    user = db.query(User).filter(User.email == email).first()
    if user:
        send_password_reset_email(user.email, user.full_name, otp, settings.OTP_EXPIRE_MINUTES)

    # Never reveal whether an account exists. When no email provider is
    # configured the code is returned so the flow remains testable locally.
    debug_otp = None if email_configured() else otp
    return {
        "message": "If that email is registered, a verification code has been sent.",
        "expires_in": settings.OTP_EXPIRE_MINUTES * 60,
        "resend_in": settings.OTP_RESEND_SECONDS,
        "debug_otp": debug_otp,
    }


@router.post("/verify-otp", response_model=VerifyOtpResponse)
def verify_otp(data: VerifyOtpRequest, db: Session = Depends(get_db)):
    """Verify the emailed OTP and return a short-lived password reset token."""
    email = data.email.lower().strip()
    now = datetime.utcnow()

    record = (
        db.query(PasswordResetOTP)
        .filter(
            PasswordResetOTP.email == email,
            PasswordResetOTP.consumed.is_(False),
            PasswordResetOTP.expires_at > now,
        )
        .order_by(PasswordResetOTP.created_at.desc(), PasswordResetOTP.id.desc())
        .first()
    )
    if not record:
        raise HTTPException(
            status_code=400,
            detail="This code is invalid or has expired. Request a new one.",
        )
    if record.attempts >= settings.OTP_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=429,
            detail="Too many incorrect attempts. Request a new code.",
        )
    if not otp_matches(email, data.otp, record.otp_hash):
        record.attempts += 1
        db.commit()
        raise HTTPException(status_code=400, detail="Incorrect verification code.")

    if not db.query(User).filter(User.email == email).first():
        raise HTTPException(
            status_code=400,
            detail="This code is invalid or has expired. Request a new one.",
        )

    record.consumed = True
    db.commit()

    reset_token = create_access_token(
        {"sub": email, "purpose": "password_reset", "otp_id": record.id},
        expires_delta=timedelta(minutes=settings.RESET_TOKEN_EXPIRE_MINUTES),
    )
    return {"message": "Code verified.", "reset_token": reset_token}


@router.post("/reset-password", response_model=MessageResponse)
def reset_password(data: ResetPasswordRequest, db: Session = Depends(get_db)):
    """Set a new password using the token issued after OTP verification."""
    payload = decode_token(data.reset_token)
    if (
        not payload
        or payload.get("purpose") != "password_reset"
        or not payload.get("sub")
    ):
        raise HTTPException(
            status_code=400,
            detail="This reset session has expired. Start the forgot-password process again.",
        )

    email = str(payload["sub"]).lower().strip()
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(
            status_code=400,
            detail="This reset session is no longer valid.",
        )

    if verify_password(data.new_password, user.hashed_password):
        raise HTTPException(
            status_code=400,
            detail="Choose a password that is different from your current one.",
        )

    user.hashed_password = hash_password(data.new_password)
    db.query(PasswordResetOTP).filter(
        PasswordResetOTP.email == email,
        PasswordResetOTP.consumed.is_(False),
    ).update({PasswordResetOTP.consumed: True}, synchronize_session=False)
    db.commit()
    return {"message": "Password updated. You can now sign in."}


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=UserOut)
def update_me(
    data: UserProfileUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if data.full_name is not None:
        current_user.full_name = data.full_name.strip()
    if data.location is not None:
        current_user.location = data.location.strip()
    if "vehicle_type" in data.model_fields_set:
        current_user.vehicle_type = data.vehicle_type.strip() if data.vehicle_type else None
    if "vehicle_number" in data.model_fields_set:
        current_user.vehicle_number = data.vehicle_number.strip() if data.vehicle_number else None
    if "vehicle_capacity_kg" in data.model_fields_set:
        current_user.vehicle_capacity_kg = data.vehicle_capacity_kg
    if data.phone is not None:
        phone = normalize_phone(data.phone)
        existing = (
            db.query(User)
            .filter(User.phone == phone, User.id != current_user.id)
            .first()
        )
        if existing:
            raise HTTPException(status_code=400, detail="Mobile number is already in use")
        current_user.phone = phone
    db.commit()
    db.refresh(current_user)
    return current_user


# ---- Role-based endpoints ----
@router.get("/users", response_model=List[UserOut])
def list_users(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    """Admin only: list all users with their roles."""
    return db.query(User).order_by(User.id).all()


@router.patch("/users/{user_id}/role", response_model=UserOut)
def update_user_role(user_id: int, data: UserRoleUpdate, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    """Admin only: change a user's role."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if data.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role. Choose from: {', '.join(VALID_ROLES)}")
    user.role = data.role
    db.commit()
    db.refresh(user)
    return user


@router.get("/farmer-area")
def farmer_area(_u: User = Depends(require_roles("farmer", "admin"))):
    return {"message": f"Hello {_u.email} (role={_u.role}). Farmer area accessed."}


@router.get("/marketer-area")
def marketer_area(_u: User = Depends(require_roles("marketer", "admin"))):
    return {"message": f"Hello {_u.email} (role={_u.role}). Marketer area accessed."}


@router.get("/admin-area")
def admin_area(_u: User = Depends(require_admin)):
    return {"message": f"Hello {_u.email} (role={_u.role}). Admin area accessed."}
