from sqlalchemy import Column, Integer, String, Text, ForeignKey, DateTime, Date, Numeric, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.database import Base


class Payment(Base):
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, index=True)
    partner_id = Column(Integer, ForeignKey("partners.id"), nullable=False)
    payment_type = Column(String(30), nullable=False)
    description = Column(String(300), nullable=False)
    amount = Column(Numeric(15, 2), nullable=False)
    contract_months = Column(Integer, nullable=True)

    day_of_month = Column(Integer, nullable=True)
    deadline_date = Column(Date, nullable=True)

    remind_days_before = Column(Integer, default=3)
    status = Column(String(20), nullable=False, default="pending")
    paid_at = Column(DateTime(timezone=True), nullable=True)
    confirmed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    postponed_until = Column(Date, nullable=True)

    last_notified_at = Column(DateTime(timezone=True), nullable=True)
    is_archived = Column(Boolean, default=False)
    notify_accounting = Column(Boolean, default=True)
    contract_url = Column(String(500), nullable=True)
    service_period = Column(String(20), nullable=True)  # monthly / yearly — for service_expiry type
    project_category = Column(String(20), nullable=True)  # web | seo | ppc — линия для CEO Dashboard
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    partner = relationship("Partner", back_populates="payments")
    confirmed_by_user = relationship("User", back_populates="confirmed_payments")
    notification_logs = relationship("NotificationLog", back_populates="payment")
    months = relationship("PaymentMonth", back_populates="payment", cascade="all, delete-orphan", order_by="PaymentMonth.month")


class PaymentMonth(Base):
    __tablename__ = "payment_months"

    id = Column(Integer, primary_key=True, index=True)
    payment_id = Column(Integer, ForeignKey("payments.id", ondelete="CASCADE"), nullable=False)
    month = Column(String(7), nullable=False)   # YYYY-MM
    amount = Column(Numeric(15, 2), nullable=True)
    status = Column(String(20), nullable=False, default="pending")  # pending / paid
    description = Column(String(300), nullable=True)  # e.g. "SEO Март 2026 Акт/СФ"
    note = Column(String(300), nullable=True)
    paid_at = Column(DateTime(timezone=True), nullable=True)
    act_issued = Column(Boolean, nullable=False, default=False)
    act_issued_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    payment = relationship("Payment", back_populates="months")


class NotificationLog(Base):
    __tablename__ = "notification_logs"

    id = Column(Integer, primary_key=True, index=True)
    payment_id = Column(Integer, ForeignKey("payments.id"), nullable=False)
    sent_to_chat_id = Column(String(50), nullable=False)
    sent_to_name = Column(String(100), nullable=True)
    message_text = Column(Text, nullable=True)
    status = Column(String(20), default="sent")  # sent / error
    sent_at = Column(DateTime(timezone=True), server_default=func.now())

    payment = relationship("Payment", back_populates="notification_logs")
