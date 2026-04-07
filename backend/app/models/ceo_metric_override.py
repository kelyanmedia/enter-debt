from sqlalchemy import Column, Integer, String, DateTime, UniqueConstraint, JSON
from sqlalchemy.sql import func
from app.db.database import Base


class CeoMetricOverride(Base):
    """Ручные значения для графиков CEO (клиенты по месяцам, оборот, LTV)."""

    __tablename__ = "ceo_metric_overrides"
    __table_args__ = (UniqueConstraint("company_slug", "metric", "year", name="uq_ceo_metric_company_year"),)

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True, default="kelyanmedia")
    metric = Column(String(32), nullable=False, index=True)
    year = Column(Integer, nullable=False)
    data = Column(JSON, nullable=False, default=dict)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
