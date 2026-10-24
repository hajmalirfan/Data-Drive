import logging

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models.user import User

logger = logging.getLogger("smartag.db_init")


def init_db_data():
    """Make sure the default admin account exists.

    The password is only set when the account is first created, so an admin
    who changes it (e.g. via forgot-password) keeps the new one.
    """
    email = settings.ADMIN_EMAIL.lower().strip()
    if not email or not settings.ADMIN_DEFAULT_PASSWORD:
        return
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.email == email).first()
        if admin is None:
            db.add(
                User(
                    email=email,
                    full_name=settings.ADMIN_NAME,
                    hashed_password=hash_password(settings.ADMIN_DEFAULT_PASSWORD),
                    role="admin",
                )
            )
            db.commit()
            logger.info("Created default admin account %s", email)
        elif admin.role != "admin":
            admin.role = "admin"
            db.commit()
            logger.info("Promoted %s to admin", email)
    finally:
        db.close()
