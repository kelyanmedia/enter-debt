from sqlalchemy import Column, Integer, String, Date, DateTime, Numeric, Text
from sqlalchemy.sql import func

from app.db.database import Base


class SubscriptionItem(Base):
    __tablename__ = "subscription_items"

    id = Column(Integer, primary_key=True, index=True)
    category = Column(String(20), nullable=False, index=True)
    name = Column(String(300), nullable=False)
    vendor = Column(String(300), nullable=True)
    amount = Column(Numeric(15, 2), nullable=True)
    currency = Column(String(3), nullable=False, default="USD")
    billing_note = Column(String(200), nullable=True)
    next_due_date = Column(Date, nullable=True)
    notes = Column(Text, nullable=True)
    link_url = Column(String(800), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
