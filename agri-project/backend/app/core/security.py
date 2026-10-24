import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from jose import JWTError, jwt
from passlib.context import CryptContext
from .config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)

def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()
    now = datetime.utcnow()
    expire = now + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    # "iat" lets sessions be invalidated after a password change.
    to_encode.update({"exp": expire, "iat": int(now.replace(tzinfo=timezone.utc).timestamp())})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

def decode_token(token: str):
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        return None


def generate_otp(length: int = 6) -> str:
    """Generate a cryptographically secure numeric OTP."""
    return "".join(str(secrets.randbelow(10)) for _ in range(length))


def hash_otp(email: str, otp: str) -> str:
    """Keyed hash so stored OTPs cannot be reversed from the database alone."""
    message = f"{email.strip().lower()}:{otp.strip()}".encode("utf-8")
    return hmac.new(settings.SECRET_KEY.encode("utf-8"), message, hashlib.sha256).hexdigest()


def otp_matches(email: str, otp: str, hashed: str) -> bool:
    return hmac.compare_digest(hash_otp(email, otp), hashed)
