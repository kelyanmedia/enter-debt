"""Подписи разделов «Проекты» и линий категорий — на компанию (company_slug)."""

from sqlalchemy import Boolean, Column, Integer, String, UniqueConstraint

from app.db.database import Base


class CompanyPaymentsSegment(Base):
    """Три фиксированных режима: all | services | hosting (логика фильтра как в UI)."""

    __tablename__ = "company_payments_segments"
    __table_args__ = (UniqueConstraint("company_slug", "segment_key", name="uq_company_payments_segment"),)

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True)
    segment_key = Column(String(32), nullable=False)
    label = Column(String(120), nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)
    is_visible = Column(Boolean, nullable=False, default=True)


class CompanyProjectLine(Base):
    """Отображаемое имя линии (category_slug в projects = project_category)."""

    __tablename__ = "company_project_lines"
    __table_args__ = (UniqueConstraint("company_slug", "category_slug", name="uq_company_project_line"),)

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True)
    category_slug = Column(String(32), nullable=False)
    label = Column(String(120), nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)
    is_visible = Column(Boolean, nullable=False, default=True)


class CompanyProjectsCostField(Base):
    """Подписи колонок себестоимости Projects Cost — отдельно для каждой компании."""

    __tablename__ = "company_projects_cost_fields"
    __table_args__ = (UniqueConstraint("company_slug", "field_key", name="uq_company_projects_cost_field"),)

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True)
    field_key = Column(String(32), nullable=False)
    label = Column(String(120), nullable=False)
