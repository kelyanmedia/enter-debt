from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class EmployeePaymentRecord(Base):
    """История выплат сотруднику (freelance): дата, сумма, период, чек; от сотрудника или от админа."""

    __tablename__ = "employee_payment_records"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    paid_on = Column(Date, nullable=False)
    period_year = Column(Integer, nullable=True)
    period_month = Column(Integer, nullable=True)
    amount = Column(Numeric(15, 2), nullable=False)
    currency = Column(String(3), nullable=False, default="USD")
    note = Column(Text, nullable=True)
    receipt_path = Column(String(500), nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", foreign_keys=[user_id])
    created_by = relationship("User", foreign_keys=[created_by_user_id])
