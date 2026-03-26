from sqlalchemy import Column, Integer, String, DateTime, BigInteger
from sqlalchemy.sql import func
from app.db.database import Base


class TelegramJoinRequest(Base):
    """Ожидает модерации после /start и ввода пароля в боте."""

    __tablename__ = "telegram_join_requests"

    id = Column(Integer, primary_key=True, index=True)
    telegram_chat_id = Column(BigInteger, unique=True, nullable=False, index=True)
    telegram_username = Column(String(100), nullable=True)
    full_name = Column(String(200), nullable=True)
    status = Column(String(20), nullable=False, default="pending")  # pending / rejected
    created_at = Column(DateTime(timezone=True), server_default=func.now())
