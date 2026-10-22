from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import Base, engine
from app.models import chat, operations, user  # noqa: F401 - register models
from app.routers import auth, bookings, chat as chat_router, crops, dashboard, markets, trucks


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
migrate_schema()

app = FastAPI(title=settings.APP_NAME)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.FRONTEND_URL,
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(chat_router.router)
app.include_router(crops.router)
app.include_router(markets.router)
app.include_router(trucks.router)
app.include_router(bookings.router)
app.include_router(dashboard.router)


@app.get("/")
def root():
    return {"message": "SmartAg Ops Advisor API running", "docs": "/docs"}


@app.get("/api/health")
def health():
    return {"status": "ok"}
