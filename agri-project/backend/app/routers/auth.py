import math
import re
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from typing import List
from app.core.config import settings
from app.core.database import get_db
from app.core.email import send_admin_login_email, send_password_reset_email, email_configured
from app.core.security_policy import audit, enforce_password_policy, rate_limit
from app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    decode_token,
    generate_otp,
    hash_otp,
    otp_matches,
)
from app.models.login_otp import AdminLoginOTP
from app.models.operations import Truck
from app.models.password_reset import PasswordResetOTP
from app.models.user import User, VALID_ROLES
from app.schemas.user import (
    UserSignup,
    UserLogin,
    TokenResponse,
    LoginResponse,
    AdminOtpVerifyRequest,
    AdminOtpResendRequest,
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

# Public sign-up is limited to these roles; admins are provisioned on startup.
SIGNUP_ROLES = ("farmer", "truck_operator")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

# Brute-force protection (per client IP). See SECURITY.md.
limit_login = rate_limit("login", 10, 60)
limit_signup = rate_limit("signup", 10, 3600)
limit_otp_send = rate_limit("otp_send", 5, 900)
limit_otp_verify = rate_limit("otp_verify", 10, 300)
limit_reset = rate_limit("reset_password", 10, 900)

# Verified against unknown accounts so response time does not reveal which emails exist.
_DUMMY_HASH = hash_password("timing-equaliser-not-a-real-password")


def _aware(moment: datetime | None) -> datetime | None:
    if moment is None:
        return None
    return moment.replace(tzinfo=timezone.utc) if moment.tzinfo is None else moment

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    payload = decode_token(token)
    # Purpose tokens (password reset, admin OTP challenge) are not sessions.
    if not payload or "sub" not in payload or payload.get("purpose"):
        raise HTTPException(status_code=401, detail="Invalid token")
    user = db.query(User).filter(User.email == payload["sub"]).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    # Sessions issued before the last password change are revoked.
    changed_at = _aware(user.password_changed_at)
    if changed_at and int(payload.get("iat") or 0) < int(changed_at.timestamp()):
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
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
def signup(data: UserSignup, request: Request, db: Session = Depends(get_db), _rl=Depends(limit_signup)):
    role = (data.role or "farmer").lower().strip()
    if role not in SIGNUP_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role. Choose from: {', '.join(SIGNUP_ROLES)}")
    phone = normalize_phone(data.phone)
    email = data.email.lower().strip() if data.email else None
    enforce_password_policy(data.password, email)
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
    audit("signup", request, user_id=user.id, role=user.role)
    token = create_access_token({"sub": user.email, "role": user.role})
    return {"access_token": token, "token_type": "bearer", "user": user}

def mask_email(email: str) -> str:
    local, _, domain = email.partition("@")
    visible = local[:2] if len(local) > 2 else local[:1]
    return f"{visible}{'*' * max(1, len(local) - len(visible))}@{domain}"


def send_admin_login_otp(user: User, db: Session) -> dict:
    """Email a fresh sign-in OTP to an admin and return the challenge payload."""
    email = user.email
    now = datetime.utcnow()

    db.query(AdminLoginOTP).filter(
        AdminLoginOTP.expires_at < now - timedelta(days=1)
    ).delete(synchronize_session=False)

    latest = (
        db.query(AdminLoginOTP)
        .filter(
            AdminLoginOTP.email == email,
            AdminLoginOTP.consumed.is_(False),
            AdminLoginOTP.expires_at > now,
        )
        .order_by(AdminLoginOTP.created_at.desc(), AdminLoginOTP.id.desc())
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

    db.query(AdminLoginOTP).filter(
        AdminLoginOTP.email == email,
        AdminLoginOTP.consumed.is_(False),
    ).update({AdminLoginOTP.consumed: True}, synchronize_session=False)

    otp = generate_otp()
    db.add(
        AdminLoginOTP(
            email=email,
            otp_hash=hash_otp(email, otp),
            expires_at=now + timedelta(minutes=settings.OTP_EXPIRE_MINUTES),
        )
    )
    sent = send_admin_login_email(email, user.full_name, otp, settings.OTP_EXPIRE_MINUTES)
    if email_configured() and not sent:
        # Don't keep a code nobody received, so the resend cooldown doesn't block a retry.
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not send the verification code. Please try again.",
        )
    db.commit()

    login_token = create_access_token(
        {"sub": email, "purpose": "admin_login"},
        expires_delta=timedelta(minutes=settings.OTP_EXPIRE_MINUTES),
    )
    return {
        "otp_required": True,
        "login_token": login_token,
        "otp_email": mask_email(email),
        "expires_in": settings.OTP_EXPIRE_MINUTES * 60,
        "resend_in": settings.OTP_RESEND_SECONDS,
        "debug_otp": None if email_configured() else otp,
    }


def admin_from_login_token(login_token: str, db: Session) -> User:
    payload = decode_token(login_token)
    if not payload or payload.get("purpose") != "admin_login" or not payload.get("sub"):
        raise HTTPException(
            status_code=400,
            detail="This sign-in session has expired. Please sign in again.",
        )
    user = db.query(User).filter(User.email == str(payload["sub"]).lower()).first()
    if not user or user.role != "admin":
        raise HTTPException(status_code=400, detail="This sign-in session is no longer valid.")
    return user


@router.post("/login", response_model=LoginResponse)
def login(data: UserLogin, request: Request, db: Session = Depends(get_db), _rl=Depends(limit_login)):
    identifier = (data.identifier or data.email or data.phone or "").strip()
    if not identifier:
        raise HTTPException(status_code=400, detail="Email or mobile number is required")

    if "@" in identifier:
        user = db.query(User).filter(User.email == identifier.lower()).first()
    else:
        phone = normalize_phone(identifier)
        user = db.query(User).filter(User.phone == phone).first()

    if not user:
        verify_password(data.password, _DUMMY_HASH)
        audit("login_failed", request, reason="unknown_account")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    now = datetime.now(timezone.utc)
    locked_until = _aware(user.locked_until)
    if locked_until and locked_until > now:
        minutes = max(1, math.ceil((locked_until - now).total_seconds() / 60))
        audit("login_blocked_locked", request, user_id=user.id)
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail=f"Too many failed sign-in attempts. Try again in {minutes} minutes or reset your password.",
        )

    if not verify_password(data.password, user.hashed_password):
        user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
        if user.failed_login_attempts >= settings.LOGIN_MAX_FAILURES:
            user.locked_until = now + timedelta(minutes=settings.LOGIN_LOCKOUT_MINUTES)
            user.failed_login_attempts = 0
            audit("account_locked", request, user_id=user.id, minutes=settings.LOGIN_LOCKOUT_MINUTES)
        else:
            audit("login_failed", request, user_id=user.id, attempts=user.failed_login_attempts)
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if user.failed_login_attempts or user.locked_until:
        user.failed_login_attempts = 0
        user.locked_until = None
        db.commit()
    if not getattr(user, "role", None):
        user.role = "farmer"
        db.commit()
        db.refresh(user)
    if user.role == "admin":
        audit("login_password_ok_otp_sent", request, user_id=user.id)
        return send_admin_login_otp(user, db)
    audit("login_success", request, user_id=user.id, role=user.role)
    token = create_access_token({"sub": user.email, "role": user.role})
    return {"access_token": token, "token_type": "bearer", "user": user}


@router.post("/login/verify-otp", response_model=TokenResponse)
def verify_admin_login_otp(
    data: AdminOtpVerifyRequest, request: Request, db: Session = Depends(get_db), _rl=Depends(limit_otp_verify)
):
    """Second step of admin sign-in: check the emailed code and issue the session."""
    user = admin_from_login_token(data.login_token, db)
    now = datetime.utcnow()

    record = (
        db.query(AdminLoginOTP)
        .filter(
            AdminLoginOTP.email == user.email,
            AdminLoginOTP.consumed.is_(False),
            AdminLoginOTP.expires_at > now,
        )
        .order_by(AdminLoginOTP.created_at.desc(), AdminLoginOTP.id.desc())
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
    if not otp_matches(user.email, data.otp, record.otp_hash):
        record.attempts += 1
        db.commit()
        audit("admin_otp_failed", request, user_id=user.id, attempts=record.attempts)
        raise HTTPException(status_code=400, detail="Incorrect verification code.")

    record.consumed = True
    db.commit()
    audit("login_success", request, user_id=user.id, role=user.role, mfa="email_otp")
    token = create_access_token({"sub": user.email, "role": user.role})
    return {"access_token": token, "token_type": "bearer", "user": user}


@router.post("/login/resend-otp", response_model=LoginResponse)
def resend_admin_login_otp(data: AdminOtpResendRequest, db: Session = Depends(get_db), _rl=Depends(limit_otp_send)):
    user = admin_from_login_token(data.login_token, db)
    return send_admin_login_otp(user, db)


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
def forgot_password(data: ForgotPasswordRequest, db: Session = Depends(get_db), _rl=Depends(limit_otp_send)):
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
def verify_otp(data: VerifyOtpRequest, db: Session = Depends(get_db), _rl=Depends(limit_otp_verify)):
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
def reset_password(
    data: ResetPasswordRequest, request: Request, db: Session = Depends(get_db), _rl=Depends(limit_reset)
):
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

    enforce_password_policy(data.new_password, user.email)
    user.hashed_password = hash_password(data.new_password)
    # Sign out every existing session and clear any lockout.
    user.password_changed_at = datetime.now(timezone.utc)
    user.failed_login_attempts = 0
    user.locked_until = None
    db.query(PasswordResetOTP).filter(
        PasswordResetOTP.email == email,
        PasswordResetOTP.consumed.is_(False),
    ).update({PasswordResetOTP.consumed: True}, synchronize_session=False)
    db.commit()
    audit("password_reset", request, user_id=user.id)
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
def update_user_role(
    user_id: int,
    data: UserRoleUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Admin only: change a user's role."""
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="You cannot change your own role")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if data.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role. Choose from: {', '.join(VALID_ROLES)}")
    previous = user.role
    user.role = data.role
    db.commit()
    db.refresh(user)
    audit("role_changed", request, admin_id=admin.id, user_id=user.id, old=previous, new=user.role)
    return user


@router.delete("/users/{user_id}", status_code=204)
def delete_user(user_id: int, request: Request, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """Admin only: permanently delete a user.

    Database rules handle related rows: crops, bookings, notifications, chats and
    documents are deleted; trucks and price entries are kept but unlinked.
    """
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="You cannot remove your own account")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == "admin" and db.query(User).filter(User.role == "admin").count() <= 1:
        raise HTTPException(status_code=400, detail="At least one admin account must remain")

    # Unlinked trucks must not stay bookable without an operator.
    db.query(Truck).filter(Truck.operator_id == user.id).update(
        {Truck.status: "inactive"}, synchronize_session=False
    )
    db.query(PasswordResetOTP).filter(PasswordResetOTP.email == user.email).delete(synchronize_session=False)
    db.query(AdminLoginOTP).filter(AdminLoginOTP.email == user.email).delete(synchronize_session=False)
    db.query(User).filter(User.id == user.id).delete(synchronize_session=False)
    db.commit()
    audit("user_deleted", request, admin_id=admin.id, user_id=user_id, role=user.role)
    return Response(status_code=204)


@router.get("/farmer-area")
def farmer_area(_u: User = Depends(require_roles("farmer", "admin"))):
    return {"message": f"Hello {_u.email} (role={_u.role}). Farmer area accessed."}


@router.get("/marketer-area")
def marketer_area(_u: User = Depends(require_roles("marketer", "admin"))):
    return {"message": f"Hello {_u.email} (role={_u.role}). Marketer area accessed."}


@router.get("/admin-area")
def admin_area(_u: User = Depends(require_admin)):
    return {"message": f"Hello {_u.email} (role={_u.role}). Admin area accessed."}
