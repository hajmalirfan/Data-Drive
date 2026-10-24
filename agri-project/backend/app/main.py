from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect

from app.core.config import settings
from app.core.database import Base, engine
from app.core import mandi_sync, metrics, security_policy
from app.models import chat, geo, login_otp, mandi, metrics as metrics_model, operations, password_reset, user, user_document  # noqa: F401 - register models
from app.routers import admin, auth, bookings, chat as chat_router, crops, dashboard, documents, finder, mandi as mandi_router, markets, trucks


def migrate_schema():
    """Lightweight SQLite migrations for databases created by earlier versions."""
    try:
        with engine.connect() as conn:
            tables = {
                row[0]
                for row in conn.exec_driver_sql(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
            if "users" not in tables:
                return

            columns = {
                row[1] for row in conn.exec_driver_sql("PRAGMA table_info(users)").fetchall()
            }
            additions = {
                "role": "ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'farmer'",
                "full_name": "ALTER TABLE users ADD COLUMN full_name VARCHAR(120) DEFAULT ''",
                "phone": "ALTER TABLE users ADD COLUMN phone VARCHAR(20)",
                "location": "ALTER TABLE users ADD COLUMN location VARCHAR(255) DEFAULT ''",
            }
            for name, statement in additions.items():
                if name not in columns:
                    conn.exec_driver_sql(statement)
                    conn.commit()

            conn.exec_driver_sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_phone ON users (phone)"
            )
            conn.exec_driver_sql(
                "UPDATE users SET role='farmer' WHERE role IS NULL OR role=''"
            )
            conn.exec_driver_sql(
                "UPDATE users SET full_name=substr(email, 1, instr(email, '@') - 1) "
                "WHERE full_name IS NULL OR full_name=''"
            )
            conn.commit()
    except Exception:
        # Fresh databases are handled by create_all below.
        pass


migrate_schema()
Base.metadata.create_all(bind=engine)


def migrate_user_vehicle_fields():
    """Add operator vehicle profile fields to existing database schemas."""
    inspector = inspect(engine)
    if not inspector.has_table("users"):
        return

    columns = {column["name"] for column in inspector.get_columns("users")}
    additions = {
        "vehicle_type": "VARCHAR(80)",
        "vehicle_number": "VARCHAR(40)",
        "vehicle_capacity_kg": "FLOAT",
        "failed_login_attempts": "INTEGER DEFAULT 0",
        "locked_until": "TIMESTAMP WITH TIME ZONE",
        "password_changed_at": "TIMESTAMP WITH TIME ZONE",
    }
    with engine.begin() as conn:
        for name, sql_type in additions.items():
            if name not in columns:
                conn.exec_driver_sql(
                    f"ALTER TABLE users ADD COLUMN {name} {sql_type}"
                )


migrate_user_vehicle_fields()
migrate_schema()

try:
    from app.core.db_init import init_db_data
    init_db_data()
except Exception as e:
    print(f"Database initialization notice: {e}")

security_policy.check_configuration()

# API docs are for development only.
_docs = not security_policy.is_production()
app = FastAPI(
    title=settings.APP_NAME,
    docs_url="/docs" if _docs else None,
    redoc_url="/redoc" if _docs else None,
    openapi_url="/openapi.json" if _docs else None,
)

app.add_middleware(
    CORSMiddleware,
    # Only the configured frontend may call the API; local dev origins outside production.
    allow_origins=[settings.FRONTEND_URL] + (
        [] if security_policy.is_production() else ["http://localhost:5173", "http://127.0.0.1:5173"]
    ),
    # Auth uses bearer tokens, not cookies, so credentials are never sent cross-origin.
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    max_age=600,
)

metrics.install(app)
security_policy.install(app)
mandi_sync.install(app)

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(documents.router)
app.include_router(chat_router.router)
app.include_router(crops.router)
app.include_router(markets.router)
app.include_router(mandi_router.router)
app.include_router(finder.router)
app.include_router(trucks.router)
app.include_router(bookings.router)
app.include_router(dashboard.router)


@app.get("/")
def root():
    return {"message": "SmartAg Ops Advisor API running"}


@app.get("/api/health")
def health():
    return {"status": "ok"}
