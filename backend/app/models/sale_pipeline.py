"""CRM: Воронки продаж — этапы и сделки."""
from __future__ import annotations

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class SalePipeline(Base):
    __tablename__ = "sale_pipelines"

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)
    created_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    stages = relationship(
        "SalePipelineStage",
        back_populates="pipeline",
        cascade="all, delete-orphan",
        order_by="SalePipelineStage.sort_order",
    )
    created_by_user = relationship("User", foreign_keys=[created_by_user_id])


class SalePipelineStage(Base):
    __tablename__ = "sale_pipeline_stages"

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True)
    pipeline_id = Column(Integer, ForeignKey("sale_pipelines.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    color = Column(String(20), nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    is_closed_won = Column(Boolean, nullable=False, default=False)
    is_closed_lost = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    pipeline = relationship("SalePipeline", back_populates="stages")
    deals = relationship(
        "SaleDeal",
        back_populates="stage",
        primaryjoin="SaleDeal.stage_id == SalePipelineStage.id",
        order_by="SaleDeal.sort_order",
    )


class SaleDeal(Base):
    __tablename__ = "sale_deals"

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True)
    pipeline_id = Column(Integer, ForeignKey("sale_pipelines.id", ondelete="CASCADE"), nullable=False, index=True)
    stage_id = Column(Integer, ForeignKey("sale_pipeline_stages.id", ondelete="SET NULL"), nullable=True, index=True)
    title = Column(String(300), nullable=False)
    contact_name = Column(String(220), nullable=True)
    company_name = Column(String(300), nullable=True)
    budget = Column(Numeric(15, 2), nullable=True)
    currency = Column(String(3), nullable=False, default="USD")
    notes = Column(Text, nullable=True)
    short_note = Column(Text, nullable=True)
    phone = Column(String(80), nullable=True)
    email = Column(String(220), nullable=True)
    source = Column(String(120), nullable=True)
    client_geo = Column(String(8), nullable=False, default="UZ")
    service_type = Column(String(40), nullable=False, default="seo")
    tags = Column(Text, nullable=True)   # JSON array of strings
    assigned_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    sales_company_id = Column(Integer, ForeignKey("sales_companies.id", ondelete="SET NULL"), nullable=True, index=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    closed_at = Column(DateTime(timezone=True), nullable=True)
    payment_id = Column(Integer, ForeignKey("payments.id", ondelete="SET NULL"), nullable=True, index=True)
    commission_id = Column(Integer, ForeignKey("commissions.id", ondelete="SET NULL"), nullable=True, index=True)

    stage = relationship("SalePipelineStage", back_populates="deals", foreign_keys=[stage_id])
    payment = relationship("Payment", foreign_keys=[payment_id])
    commission = relationship("Commission", foreign_keys=[commission_id])
    pipeline = relationship("SalePipeline", foreign_keys=[pipeline_id])
    assigned_user = relationship("User", foreign_keys=[assigned_user_id])
    created_by_user = relationship("User", foreign_keys=[created_by_user_id])
    sales_company = relationship("SalesCompany", foreign_keys=[sales_company_id])
    comments = relationship(
        "SaleDealComment",
        back_populates="deal",
        cascade="all, delete-orphan",
        order_by="SaleDealComment.created_at",
    )
    tasks = relationship(
        "SaleDealTask",
        back_populates="deal",
        cascade="all, delete-orphan",
        order_by="SaleDealTask.due_at",
    )


class SaleDealComment(Base):
    __tablename__ = "sale_deal_comments"

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True)
    deal_id = Column(Integer, ForeignKey("sale_deals.id", ondelete="CASCADE"), nullable=False, index=True)
    body = Column(Text, nullable=False)
    kind = Column(String(20), nullable=False, default="comment")  # comment | stage_change | system
    meta_json = Column(Text, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    deal = relationship("SaleDeal", back_populates="comments")
    created_by_user = relationship("User", foreign_keys=[created_by_user_id])
