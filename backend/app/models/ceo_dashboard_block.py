"""Порядок и настройки блоков CEO Dashboard — на компанию (company_slug)."""

from sqlalchemy import Column, Integer, String

from app.db.database import Base


class CeoDashboardBlock(Base):
    __tablename__ = "ceo_dashboard_blocks"

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True)
    kind = Column(String(32), nullable=False)
    pl_row_id = Column(String(80), nullable=True)
    title = Column(String(200), nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
