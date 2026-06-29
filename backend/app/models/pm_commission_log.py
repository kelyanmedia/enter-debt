from sqlalchemy import Column, Integer, String, Numeric, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.db.database import Base


class PmCommissionLog(Base):
    __tablename__ = "pm_commission_logs"

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True, default="kelyanmedia")
    payment_id = Column(Integer, ForeignKey("payments.id", ondelete="CASCADE"), nullable=False, index=True)
    pm_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(32), nullable=False)  # lock | override | mark_paid | fields_update
    rate_percent = Column(Numeric(5, 2), nullable=True)
    amount = Column(Numeric(15, 2), nullable=True)
    profit = Column(Numeric(15, 2), nullable=True)
    inputs_json = Column(Text, nullable=True)
    actor_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    override_reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
