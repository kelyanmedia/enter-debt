from sqlalchemy import Column, Integer, String, Text, ForeignKey, DateTime, Date, Numeric, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.database import Base


class Payment(Base):
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, index=True)
    partner_id = Column(Integer, ForeignKey("partners.id"), nullable=False)
    payment_type = Column(String(30), nullable=False)  # regular / service / one_time
    description = Column(String(300), nullable=False)
    amount = Column(Numeric(15, 2), nullable=False)

    # For regular: day of month (1-31). For service/one_time: deadline_date
    day_of_month = Column(Integer, nullable=True)
    deadline_date = Column(Date, nullable=True)

    remind_days_before = Column(Integer, default=3)
    status = Column(String(20), nullable=False, default="pending")  # pending / paid / overdue / postponed
    paid_at = Column(DateTime(timezone=True), nullable=True)
    confirmed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    postponed_until = Column(Date, nullable=True)

    last_notified_at = Column(DateTime(timezone=True), nullable=True)
    is_archived = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    partner = relationship("Partner", back_populates="payments")
    confirmed_by_user = relationship("User", back_populates="confirmed_payments")
    notification_logs = relationship("NotificationLog", back_populates="payment")


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
