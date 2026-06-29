"""CRM: задачи по сделкам с напоминаниями."""
from __future__ import annotations

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class SaleDealTask(Base):
    __tablename__ = "sale_deal_tasks"

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True)
    deal_id = Column(Integer, ForeignKey("sale_deals.id", ondelete="CASCADE"), nullable=False, index=True)
    task_type = Column(String(40), nullable=False, default="call")  # call | meeting | email | other
    title = Column(String(300), nullable=True)
    notes = Column(Text, nullable=True)
    due_at = Column(DateTime(timezone=True), nullable=False, index=True)
    remind_minutes_before = Column(Integer, nullable=False, default=15)
    reminder_sent_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String(20), nullable=False, default="pending")  # pending | done | cancelled
    assigned_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)

    deal = relationship("SaleDeal", back_populates="tasks", foreign_keys=[deal_id])
    assigned_user = relationship("User", foreign_keys=[assigned_user_id])
    created_by_user = relationship("User", foreign_keys=[created_by_user_id])
