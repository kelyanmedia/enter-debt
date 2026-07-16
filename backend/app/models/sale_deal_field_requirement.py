"""Обязательные поля сделки по менеджеру (автоматизации CRM)."""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from app.db.database import Base


class SaleDealFieldRequirement(Base):
    __tablename__ = "sale_deal_field_requirements"
    __table_args__ = (
        UniqueConstraint(
            "company_slug",
            "manager_user_id",
            name="uq_sale_deal_field_req_company_manager",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True)
    manager_user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # JSON-массив ключей: contact_name, phone, contact_position, company_name, source, client_geo, service_type
    required_fields = Column(Text, nullable=False, default="[]")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
