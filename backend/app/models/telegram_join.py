from sqlalchemy import Column, Integer, String, DateTime, BigInteger, UniqueConstraint
from sqlalchemy.sql import func
from app.db.database import Base


class TelegramJoinRequest(Base):
    """Ожидает модерации после /start и ввода пароля в боте."""

    __tablename__ = "telegram_join_requests"
    __table_args__ = (UniqueConstraint("company_slug", "telegram_chat_id", name="uq_tg_join_company_chat"),)

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True, default="kelyanmedia")
    telegram_chat_id = Column(BigInteger, nullable=False, index=True)
    telegram_username = Column(String(100), nullable=True)
    full_name = Column(String(200), nullable=True)
    status = Column(String(20), nullable=False, default="pending")  # pending / rejected
    created_at = Column(DateTime(timezone=True), server_default=func.now())
