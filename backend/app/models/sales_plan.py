"""План продаж: направления и суммы план/факт по месяцам (по менеджеру)."""

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class SalesPlanCategory(Base):
    __tablename__ = "sales_plan_categories"

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    color = Column(String(20), nullable=False, default="#3b82f6")
    avg_check = Column(BigInteger, nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    is_archived = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    entries = relationship(
        "SalesPlanEntry",
        back_populates="category",
        cascade="all, delete-orphan",
    )


class SalesPlanEntry(Base):
    __tablename__ = "sales_plan_entries"
    __table_args__ = (
        UniqueConstraint(
            "manager_user_id",
            "category_id",
            "year",
            "month",
            name="uq_sales_plan_entry_mgr_cat_year_month",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True)
    manager_user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    category_id = Column(
        Integer,
        ForeignKey("sales_plan_categories.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)  # 1–12
    plan_amount = Column(BigInteger, nullable=False, default=0)
    fact_amount = Column(BigInteger, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    category = relationship("SalesPlanCategory", back_populates="entries")
