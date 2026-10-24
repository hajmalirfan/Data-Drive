from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    APP_NAME: str = "SmartAg Ops Advisor API"
    SECRET_KEY: str = "change-this-to-a-long-random-secret-key"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 1 day
    DATABASE_URL: str = "postgresql+psycopg2://postgres:postgres@127.0.0.1:5432/agri"
    FRONTEND_URL: str = "http://localhost:5173"
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-flash-latest"
    GEMINI_TIMEOUT_SECONDS: int = 180
    # Voice input transcription: a fast "lite" model; falls back to GEMINI_MODEL when busy.
    GEMINI_SPEECH_MODEL: str = "gemini-flash-lite-latest"
    SEED_DEMO_DATA: bool = False

    # AI answer size and history limits (kept small for fast, focused replies)
    AI_MAX_OUTPUT_TOKENS: int = 200
    AI_MAX_HISTORY_MESSAGES: int = 6
    AI_MAX_INPUT_CHARS: int = 1200

    # Local Ollama provider
    OLLAMA_BASE_URL: str = "http://127.0.0.1:11434"
    OLLAMA_MODEL: str = "llama3.2:3b"
    OLLAMA_TIMEOUT_SECONDS: int = 120
    TRANSPORT_RATE_PER_KM: float = 28.0
    LOADING_COST: float = 500.0
    MARKET_LOSS_PCT: float = 2.0
    LABOUR_COST_PER_KG: float = 0.4
    COMMISSION_PCT: float = 2.0
    PACKAGING_COST_PER_KG: float = 0.25
    STALE_PRICE_HOURS: int = 48

    # Password reset / OTP
    OTP_EXPIRE_MINUTES: int = 10
    OTP_RESEND_SECONDS: int = 60
    OTP_MAX_ATTEMPTS: int = 5
    RESET_TOKEN_EXPIRE_MINUTES: int = 15

    # Default admin account (created on startup if missing). Admin sign-in
    # always requires an emailed OTP after the password check.
    ADMIN_EMAIL: str = ""
    ADMIN_DEFAULT_PASSWORD: str = ""
    ADMIN_NAME: str = "Admin"

    # Mailtrap Email Sending API (takes priority when the token is set)
    MAILTRAP_API_TOKEN: str = ""
    MAILTRAP_API_URL: str = "https://send.api.mailtrap.io/api/send"
    MAILTRAP_FROM_EMAIL: str = "SmartAgopsAdvisor@demomailtrap.co"
    MAILTRAP_FROM_NAME: str = "SmartAg Ops Advisor"

    # SMTP fallback (leave SMTP_HOST empty to log OTPs to the console in local dev)
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""
    SMTP_USE_TLS: bool = True
    SMTP_USE_SSL: bool = False

    class Config:
        env_file = ".env"

settings = Settings()
