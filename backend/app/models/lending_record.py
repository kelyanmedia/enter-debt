"""Выданные кредиты / безвозмездные займы (инвестиции на срок) — учёт по компании."""

from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class LendingRecord(Base):
    __tablename__ = "lending_records"

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True)
    payment_id = Column(Integer, ForeignKey("payments.id", ondelete="SET NULL"), nullable=True, index=True)
    # Проект внутри компании или название компании-заёмщика (произвольный текст)
    entity_name = Column(String(500), nullable=False)
    # interest_loan — % в месяц; interest_free — без процентов на период (инвестиция / безвозмездно)
    record_type = Column(String(32), nullable=False)
    issued_on = Column(Date, nullable=False)
    principal_uzs = Column(Numeric(15, 2), nullable=False)
    monthly_rate_percent = Column(Numeric(10, 4), nullable=True)
    total_repayment_uzs = Column(Numeric(15, 2), nullable=False)
    deadline_date = Column(Date, nullable=True)
    period_note = Column(String(500), nullable=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    payment = relationship("Payment")
