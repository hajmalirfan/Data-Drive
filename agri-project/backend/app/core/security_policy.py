"""Application security policy: headers, request limits, rate limiting,
password rules and security audit logging. See SECURITY.md."""
import logging
import re
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from app.core.config import settings

# ---- Audit log ------------------------------------------------------------
# App loggers ("smartag.*") print INFO to the console next to uvicorn's logs.
_app_logger = logging.getLogger("smartag")
if not _app_logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    _app_logger.addHandler(_handler)
    _app_logger.setLevel(logging.INFO)
    _app_logger.propagate = False

audit_logger = logging.getLogger("smartag.security")


def client_ip(request: Request | None) -> str:
    if request is None or request.client is None:
        return "-"
    return request.client.host


def audit(event: str, request: Request | None = None, **fields) -> None:
    """One line per security event: logins, lockouts, role changes, deletions..."""
    details = " ".join(f"{key}={value}" for key, value in fields.items() if value is not None)
    audit_logger.info("%s ip=%s %s", event, client_ip(request), details)


def is_production() -> bool:
    return settings.ENVIRONMENT.lower() in ("production", "prod")


# ---- Startup checks -------------------------------------------------------
WEAK_SECRETS = {"", "change-this-to-a-long-random-secret-key", "secret", "changeme"}


def check_configuration() -> None:
    weak_secret = settings.SECRET_KEY in WEAK_SECRETS or len(settings.SECRET_KEY) < 32
    if is_production():
        if weak_secret:
            raise RuntimeError("SECRET_KEY must be a random value of at least 32 characters in production.")
        if not settings.FRONTEND_URL.startswith("https://"):
            raise RuntimeError("FRONTEND_URL must use https:// in production.")
    elif weak_secret:
        audit_logger.warning("SECRET_KEY is weak; set a long random value before deploying.")
    if settings.ADMIN_DEFAULT_PASSWORD and password_problem(settings.ADMIN_DEFAULT_PASSWORD):
        audit_logger.warning("ADMIN_DEFAULT_PASSWORD does not meet the password policy; change the admin password after first sign-in.")


# ---- Password policy ------------------------------------------------------
COMMON_PASSWORDS = {
    "password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123",
    "qwertyuiop", "11111111", "00000000", "abc12345", "abcd1234", "iloveyou", "admin123",
    "welcome1", "welcome123", "letmein1", "farmer123", "india123", "passw0rd", "p@ssw0rd",
}


def password_problem(password: str, email: str | None = None) -> str | None:
    """Return a user-facing reason the password is rejected, or None if it is acceptable."""
    if len(password) < settings.PASSWORD_MIN_LENGTH:
        return f"Password must be at least {settings.PASSWORD_MIN_LENGTH} characters"
    if len(password) > 128:
        return "Password must be at most 128 characters"
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        return "Password must contain at least one letter and one number"
    if password.lower() in COMMON_PASSWORDS:
        return "This password is too common. Choose a less predictable one"
    local = (email or "").split("@")[0].lower()
    if len(local) >= 4 and local in password.lower():
        return "Password must not contain your email name"
    return None


def enforce_password_policy(password: str, email: str | None = None) -> None:
    problem = password_problem(password, email)
    if problem:
        raise HTTPException(status_code=400, detail=problem)


# ---- Rate limiting --------------------------------------------------------
class RateLimiter:
    """In-memory sliding-window limiter (per process). Keys are e.g. 'login:<ip>'."""

    def __init__(self):
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window_seconds: int) -> int:
        """Record a hit; return 0 if allowed, else seconds until the next allowed hit."""
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and hits[0] <= now - window_seconds:
                hits.popleft()
            if len(hits) >= limit:
                return max(1, int(hits[0] + window_seconds - now) + 1)
            hits.append(now)
            if len(self._hits) > 50_000:  # drop idle keys so memory stays bounded
                for stale in [k for k, v in self._hits.items() if not v]:
                    del self._hits[stale]
            return 0


limiter = RateLimiter()


def rate_limit(name: str, limit: int, window_seconds: int):
    """FastAPI dependency: at most `limit` requests per client IP per window."""

    def dependency(request: Request) -> None:
        retry_after = limiter.hit(f"{name}:{client_ip(request)}", limit, window_seconds)
        if retry_after:
            audit("rate_limited", request, rule=name)
            raise HTTPException(
                status_code=429,
                detail=f"Too many requests. Please try again in {retry_after} seconds.",
                headers={"Retry-After": str(retry_after)},
            )

    return dependency


# ---- HTTP middleware ------------------------------------------------------
DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")
API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
PERMISSIONS_POLICY = "camera=(), microphone=(self), geolocation=(self), payment=(), usb=(), interest-cohort=()"


def install(app) -> None:
    @app.middleware("http")
    async def security_policy(request: Request, call_next):
        # Reject oversized bodies before reading them (uploads are capped lower per endpoint).
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > settings.MAX_REQUEST_BYTES:
            return JSONResponse({"detail": "Request is too large"}, status_code=413)

        response = await call_next(request)
        headers = response.headers
        headers.setdefault("X-Content-Type-Options", "nosniff")
        headers.setdefault("X-Frame-Options", "DENY")
        headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        headers.setdefault("Permissions-Policy", PERMISSIONS_POLICY)
        headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        headers.setdefault("Cross-Origin-Resource-Policy", "same-site")
        if not request.url.path.startswith(DOCS_PATHS):
            headers.setdefault("Content-Security-Policy", API_CSP)
        if request.url.path.startswith("/api/"):
            headers.setdefault("Cache-Control", "no-store")
        if is_production():
            headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response
