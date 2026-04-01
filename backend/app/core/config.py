from pydantic import field_validator
from pydantic_settings import BaseSettings
from typing import Optional
import os


class Settings(BaseSettings):
    DATABASE_URL: str = os.environ.get("DATABASE_URL", "postgresql://enterdebt:enterdebt123@localhost:5432/enterdebt")
    # Необязательные URL отдельных БД по компаниям. Если не заданы — для PostgreSQL
    # подставляются базы enterdebt_whiteway и enterdebt_enter_group_media (тот же хост/юзер).
    DATABASE_URL_KELYANMEDIA: Optional[str] = None
    DATABASE_URL_WHITEWAY: Optional[str] = None
    DATABASE_URL_ENTER_GROUP_MEDIA: Optional[str] = None
    SECRET_KEY: str = "supersecretkey_change_in_prod"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7

    BOT_TOKEN: Optional[str] = None
    API_URL: str = "http://localhost:8000"
    # Пароль, который пользователь вводит в боте после /start (до заявки на модерацию)
    BOT_ACCESS_PASSWORD: str = "EnterDebt2026"
    # Общий секрет для вызовов API из бота (заголовок X-Internal-Secret); пустой env = дефолт как в bot.py
    INTERNAL_API_SECRET: str = "change_internal_secret_in_production"

    @field_validator("INTERNAL_API_SECRET", mode="before")
    @classmethod
    def _internal_secret_nonempty(cls, v):
        if v is None or (isinstance(v, str) and not v.strip()):
            return "change_internal_secret_in_production"
        return str(v).strip()
    # Ссылка на веб-панель для сообщений менеджеру после одобрения
    APP_PUBLIC_URL: str = "https://debt.agasiarakelyan.com"

    ADMIN_EMAIL: str = "agasi@gmail.com"
    ADMIN_PASSWORD: str = "KM2026admin_controlpanel"
    # Telegram Chat ID главного админа (заявки из бота, уведомления; seed привязывает к пользователю admin)
    ADMIN_TELEGRAM_CHAT_ID: int = 1333127107

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
