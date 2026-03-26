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
    # Пароль, который пользователь вводит в боте после /start (до заявки на модерацию)
    BOT_ACCESS_PASSWORD: str = "EnterDebt2026"
    # Общий секрет для вызовов API из бота (заголовок X-Internal-Secret)
    INTERNAL_API_SECRET: str = "change_internal_secret_in_production"
    # Ссылка на веб-панель для сообщений менеджеру после одобрения
    APP_PUBLIC_URL: str = "https://debt.agasiarakelyan.com"

    ADMIN_EMAIL: str = "agasi@gmail.com"
    ADMIN_PASSWORD: str = "KM2026admin_controlpanel"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
