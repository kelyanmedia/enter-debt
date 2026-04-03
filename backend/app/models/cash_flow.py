from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class CashFlowTemplateLine(Base):
    """Строки месячных шаблонов ДДС (зарплаты, админ) — копируются в cash_flow_entries по кнопке «+»."""

    __tablename__ = "cash_flow_template_lines"

    id = Column(Integer, primary_key=True, index=True)
    template_group = Column(String(40), nullable=False, index=True)
    sort_order = Column(Integer, nullable=False, default=0)
    label = Column(String(200), nullable=False)
    default_amount_uzs = Column(Numeric(15, 2), nullable=False, default=0)
    default_amount_usd = Column(Numeric(15, 2), nullable=False, default=0)
    flow_category = Column(String(64), nullable=False)
    payment_method = Column(String(20), nullable=False, default="transfer")
    direction = Column(String(10), nullable=False, default="expense")


class CashFlowEntry(Base):
    """Строка движения ДДС за конкретный месяц (приход или расход)."""

    __tablename__ = "cash_flow_entries"

    id = Column(Integer, primary_key=True, index=True)
    period_month = Column(String(7), nullable=False, index=True)  # YYYY-MM для отчётов; с entry_date = месяц этой даты
    entry_date = Column(Date, nullable=True)
    direction = Column(String(10), nullable=False)
    label = Column(String(300), nullable=False)
    amount_uzs = Column(Numeric(15, 2), nullable=False, default=0)
    amount_usd = Column(Numeric(15, 2), nullable=False, default=0)
    payment_method = Column(String(20), nullable=False, default="transfer")
    flow_category = Column(String(64), nullable=True)
    recipient = Column(String(120), nullable=True)
    payment_id = Column(Integer, ForeignKey("payments.id", ondelete="SET NULL"), nullable=True)
    notes = Column(String(500), nullable=True)
    template_line_id = Column(Integer, ForeignKey("cash_flow_template_lines.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    payment = relationship("Payment", foreign_keys=[payment_id])
    template_line = relationship("CashFlowTemplateLine", foreign_keys=[template_line_id])
