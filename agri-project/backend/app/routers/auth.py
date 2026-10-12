from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.core.security import hash_password, verify_password, create_access_token, decode_token
from app.models.user import User, VALID_ROLES
from app.schemas.user import UserSignup, UserLogin, TokenResponse, UserOut, UserRoleUpdate

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
require_fpo = require_roles("fpo", "admin")
require_marketer = require_roles("marketer", "admin")
require_farmer = require_roles("farmer", "fpo", "marketer", "admin")

@router.post("/signup", response_model=TokenResponse, status_code=201)
def signup(data: UserSignup, db: Session = Depends(get_db)):
    email = data.email.lower().strip()
    role = (data.role or "farmer").lower().strip()
    if role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role. Choose from: {', '.join(VALID_ROLES)}")
    if len(data.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered. Please Sign In.")
    user = User(email=email, hashed_password=hash_password(data.password), role=role)
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token({"sub": user.email, "role": user.role})
    return {"access_token": token, "token_type": "bearer", "user": user}

@router.post("/login", response_model=TokenResponse)
def login(data: UserLogin, db: Session = Depends(get_db)):
    email = data.email.lower().strip()
    user = db.query(User).filter(User.email == email).first()
    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not getattr(user, "role", None):
        user.role = "farmer"
        db.commit()
        db.refresh(user)
    token = create_access_token({"sub": user.email, "role": user.role})
    return {"access_token": token, "token_type": "bearer", "user": user}

@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
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


@router.get("/fpo-area")
def fpo_area(_u: User = Depends(require_roles("fpo", "admin"))):
    return {"message": f"Hello {_u.email} (role={_u.role}). FPO area accessed."}


@router.get("/marketer-area")
def marketer_area(_u: User = Depends(require_roles("marketer", "admin"))):
    return {"message": f"Hello {_u.email} (role={_u.role}). Marketer area accessed."}


@router.get("/admin-area")
def admin_area(_u: User = Depends(require_admin)):
    return {"message": f"Hello {_u.email} (role={_u.role}). Admin area accessed."}
