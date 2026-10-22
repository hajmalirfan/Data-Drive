from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    APP_NAME: str = "SmartAg Ops Advisor API"
    SECRET_KEY: str = "change-this-to-a-long-random-secret-key"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 1 day
    DATABASE_URL: str = "postgresql+psycopg2://postgres:postgres@127.0.0.1:5432/agri"
    FRONTEND_URL: str = "http://localhost:5173"
    OLLAMA_BASE_URL: str = "http://127.0.0.1:11434"
    OLLAMA_MODEL: str = "llama3.2:3b"
    OLLAMA_TIMEOUT_SECONDS: int = 180
    SEED_DEMO_DATA: bool = False
    TRANSPORT_RATE_PER_KM: float = 28.0
    LOADING_COST: float = 500.0
    MARKET_LOSS_PCT: float = 2.0
    LABOUR_COST_PER_KG: float = 0.4
    COMMISSION_PCT: float = 2.0
    PACKAGING_COST_PER_KG: float = 0.25
    STALE_PRICE_HOURS: int = 48

    class Config:
        env_file = ".env"

settings = Settings()
