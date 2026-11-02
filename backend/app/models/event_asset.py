"""Раздел «Активы»: позиции для мероприятий (стойки, оборудование) с отметками перемещения."""

from sqlalchemy import Boolean, Column, Date, DateTime, Numeric, ForeignKey, Integer, String, Text
from sqlalchemy.sql import func

from app.db.database import Base


class EventAssetCategory(Base):
    __tablename__ = "event_asset_categories"

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True, default="kelyanmedia")
    name = Column(String(120), nullable=False)
    color = Column(String(16), nullable=False, default="#ffffff")


class EventAsset(Base):
    __tablename__ = "event_assets"

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True, default="kelyanmedia")
    name = Column(String(300), nullable=False)
    description = Column(Text, nullable=True)
    quantity = Column(Integer, nullable=False, default=1)
    category_id = Column(Integer, ForeignKey("event_asset_categories.id", ondelete="SET NULL"), nullable=True, index=True)
    # Три независимые отметки: кто и когда поставил.
    out_warehouse_by = Column(String(200), nullable=True)
    out_warehouse_at = Column(DateTime(timezone=True), nullable=True)
    out_site_by = Column(String(200), nullable=True)
    out_site_at = Column(DateTime(timezone=True), nullable=True)
    back_warehouse_by = Column(String(200), nullable=True)
    back_warehouse_at = Column(DateTime(timezone=True), nullable=True)
    added_on = Column(Date, nullable=True)
    price = Column(Numeric(14, 2), nullable=True)
    market_rent = Column(Numeric(14, 2), nullable=True)
    photo_path = Column(String(500), nullable=True)
    created_by = Column(String(200), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class EventAssetSetting(Base):
    """Флаг: раздел «Активы» открыт администратором для компании."""

    __tablename__ = "event_asset_settings"

    company_slug = Column(String(32), primary_key=True)
    enabled = Column(Boolean, nullable=False, default=False)


class EventAssetUsage(Base):
    """История: по каким проектам выдавался актив. Стоимость аренды — только внутренняя, в PDF не попадает."""

    __tablename__ = "event_asset_usages"

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True, default="kelyanmedia")
    asset_id = Column(Integer, ForeignKey("event_assets.id", ondelete="CASCADE"), nullable=False, index=True)
    export_id = Column(String(40), nullable=True, index=True)
    project_name = Column(String(300), nullable=False)
    date_from = Column(Date, nullable=True)
    date_to = Column(Date, nullable=True)
    manager_name = Column(String(200), nullable=True)
    quantity = Column(Integer, nullable=False, default=1)
    rental_cost = Column(Numeric(14, 2), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class EventAssetAccess(Base):
    """Каким пользователям админ открыл раздел «Активы»."""

    __tablename__ = "event_asset_access"

    company_slug = Column(String(32), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
