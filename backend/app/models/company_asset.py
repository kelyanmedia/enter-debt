"""Учёт имущества компании (мебель, техника и т.д.)."""

from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class CompanyAsset(Base):
    __tablename__ = "company_assets"

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True, default="kelyanmedia")
    name = Column(String(300), nullable=False)
    purchased_on = Column(Date, nullable=True)
    serial_number = Column(String(220), nullable=True)
    seller_contacts = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    # Выдача имущества сотруднику и комплект, переданный вместе с активом.
    assigned_to_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    issued_on = Column(Date, nullable=True)
    issued_items = Column(Text, nullable=True)
    storage_location = Column(String(320), nullable=True)
    # Учёт Apple ID для корпоративной техники. Пароль отдаётся только администратору.
    icloud_login = Column(String(320), nullable=True)
    icloud_password = Column(Text, nullable=True)
    photo_path = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    assigned_to_user = relationship("User", foreign_keys=[assigned_to_user_id])
