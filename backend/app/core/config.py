from pydantic_settings import BaseSettings
from typing import Optional
import os


class Settings(BaseSettings):
    DATABASE_URL: str = os.environ.get("DATABASE_URL", "postgresql://enterdebt:enterdebt123@localhost:5432/enterdebt")
    SECRET_KEY: str = "supersecretkey_change_in_prod"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7

    BOT_TOKEN: Optional[str] = None
    API_URL: str = "http://localhost:8000"

    ADMIN_EMAIL: str = "agasi@gmail.com"
    ADMIN_PASSWORD: str = "KM2026admin_controlpanel"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
