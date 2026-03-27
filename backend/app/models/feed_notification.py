from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.database import Base


class FeedNotification(Base):
    __tablename__ = "feed_notifications"

    id = Column(Integer, primary_key=True, index=True)
    kind = Column(String(40), nullable=False)  # payment_created | partner_created | user_created
    title = Column(String(200), nullable=False)
    subtitle = Column(String(400), nullable=True)
    entity_type = Column(String(20), nullable=False)  # payment | partner | user
    entity_id = Column(Integer, nullable=False)
    partner_id = Column(Integer, ForeignKey("partners.id"), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    reads = relationship("FeedNotificationRead", back_populates="notification", cascade="all, delete-orphan")


class FeedNotificationRead(Base):
    __tablename__ = "feed_notification_reads"

    id = Column(Integer, primary_key=True, index=True)
    notification_id = Column(Integer, ForeignKey("feed_notifications.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    read_at = Column(DateTime(timezone=True), server_default=func.now())

    notification = relationship("FeedNotification", back_populates="reads")

    __table_args__ = (UniqueConstraint("notification_id", "user_id", name="uq_feed_notification_read_user"),)
