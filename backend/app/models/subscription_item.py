from sqlalchemy import Column, Integer, String, Date, DateTime, Numeric, Text, SmallInteger
from sqlalchemy.sql import func

from app.db.database import Base


class SubscriptionItem(Base):
    __tablename__ = "subscription_items"

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True, default="kelyanmedia")
    category = Column(String(20), nullable=False, index=True)
    name = Column(String(300), nullable=False)
    status = Column(String(20), nullable=False, default="active")
    tag = Column(String(320), nullable=True)
    payer_code = Column(String(8), nullable=True)
    payment_method = Column(String(200), nullable=True)
    phone_number = Column(String(32), nullable=True)
    vendor = Column(String(300), nullable=True)
    amount = Column(Numeric(15, 2), nullable=True)
    currency = Column(String(3), nullable=False, default="USD")
    billing_note = Column(String(200), nullable=True)
    next_due_date = Column(Date, nullable=True)
    next_deadline_at = Column(DateTime(timezone=True), nullable=True)
    recurrence = Column(String(10), nullable=False, default="once")
    reminder_days_before = Column(SmallInteger, nullable=False, default=0)
    reminder_sent_for_deadline_at = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text, nullable=True)
    link_url = Column(String(800), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
