from sqlalchemy import Column, Integer, String, Boolean, DateTime, BigInteger, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    email = Column(String(200), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False, default="manager")  # admin / manager / accountant / administration / employee
    # JSON-массив id менеджеров (только role=administration): видимость партнёров и проектов
    visible_manager_ids = Column(Text, nullable=True)
    # Реквизиты для выплат (Visa, Uzcard и т.д.) — для роли employee
    payment_details = Column(Text, nullable=True)
    payment_details_updated_at = Column(DateTime(timezone=True), nullable=True)
    telegram_id = Column(String(50), unique=True, nullable=True)
    telegram_chat_id = Column(BigInteger, unique=True, nullable=True)
    telegram_username = Column(String(100), nullable=True)
    is_active = Column(Boolean, default=True)
    web_access = Column(Boolean, nullable=False, default=True)  # False = только Telegram (бухгалтерия)
    # Только role=administration: доступ к разделам подписок/доступов
    can_view_subscriptions = Column(Boolean, nullable=False, default=False)
    can_view_accesses = Column(Boolean, nullable=False, default=False)
    # Сотрудник (freelance): True = в кабинете можно переключать компанию (отдельные БД и выплаты)
    multi_company_access = Column(Boolean, nullable=False, default=False)
    see_all_partners = Column(Boolean, nullable=False, default=False)  # менеджер: True = видит всех партнёров
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    feed_cleared_at = Column(DateTime(timezone=True), nullable=True)
    last_login_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    managed_partners = relationship("Partner", back_populates="manager")
    confirmed_payments = relationship("Payment", back_populates="confirmed_by_user")
    employee_tasks = relationship("EmployeeTask", back_populates="user", cascade="all, delete-orphan")
