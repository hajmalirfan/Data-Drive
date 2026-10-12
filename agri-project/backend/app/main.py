from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.database import Base, engine, SessionLocal
from app.models import user  # noqa: F401 - register model
from app.models.user import User
from app.core.security import hash_password
from app.routers import auth
from app.core.config import settings


def migrate_add_role_column():
    """Add users.role column for DBs created before roles existed."""
    try:
        with engine.connect() as conn:
            cols = [r[1] for r in conn.exec_driver_sql("PRAGMA table_info(users)").fetchall()]
            if "role" not in cols:
                conn.exec_driver_sql("ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'farmer'")
                conn.commit()
            # Backfill NULL / empty roles
            conn.exec_driver_sql("UPDATE users SET role='farmer' WHERE role IS NULL OR role=''")
            conn.commit()
    except Exception:
        # Table may not exist yet on first run; create_all below will handle it
        pass


def seed_default_admin():
    """Create a default admin for first-time testing if none exists."""
    try:
        db = SessionLocal()
        try:
            admin = db.query(User).filter(User.email == "admin@example.com").first()
            if not admin:
                admin = User(
                    email="admin@example.com",
                    hashed_password=hash_password("Admin123"),
                    role="admin",
                )
                db.add(admin)
                db.commit()
        finally:
            db.close()
    except Exception:
        pass


migrate_add_role_column()
Base.metadata.create_all(bind=engine)
# Re-run migration after create (covers fresh DB + old DB cases)
migrate_add_role_column()
seed_default_admin()

app = FastAPI(title=settings.APP_NAME)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL, "http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)

@app.get("/")
def root():
    return {"message": "Agri API running", "docs": "/docs"}

@app.get("/api/health")
def health():
    return {"status": "ok"}
