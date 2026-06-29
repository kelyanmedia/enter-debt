"""CRM: календарь встреч продаж."""
from __future__ import annotations

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class SaleMeeting(Base):
    __tablename__ = "sale_meetings"

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True)
    contact_name = Column(String(220), nullable=False)
    company_name = Column(String(300), nullable=False)
    sales_company_id = Column(Integer, ForeignKey("sales_companies.id", ondelete="SET NULL"), nullable=True, index=True)
    sale_deal_id = Column(Integer, ForeignKey("sale_deals.id", ondelete="SET NULL"), nullable=True, index=True)
    service_type = Column(String(40), nullable=False, default="discovery")
    starts_at = Column(DateTime(timezone=True), nullable=False, index=True)
    duration_minutes = Column(Integer, nullable=False, default=60)
    notes = Column(Text, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    sales_company = relationship("SalesCompany", foreign_keys=[sales_company_id])
    sale_deal = relationship("SaleDeal", foreign_keys=[sale_deal_id])
    created_by_user = relationship("User", foreign_keys=[created_by_user_id])
    participants = relationship(
        "SaleMeetingParticipant",
        back_populates="meeting",
        cascade="all, delete-orphan",
    )


class SaleMeetingParticipant(Base):
    __tablename__ = "sale_meeting_participants"

    id = Column(Integer, primary_key=True, index=True)
    meeting_id = Column(Integer, ForeignKey("sale_meetings.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    meeting = relationship("SaleMeeting", back_populates="participants")
    user = relationship("User", foreign_keys=[user_id])
