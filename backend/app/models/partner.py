from sqlalchemy import Column, Integer, String, Text, ForeignKey, DateTime, Boolean, Date
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.database import Base


class Partner(Base):
    __tablename__ = "partners"

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True, default="kelyanmedia")
    name = Column(String(200), nullable=False, index=True)
    contact_person = Column(String(200), nullable=True)
    phone = Column(String(50), nullable=True)
    email = Column(String(200), nullable=True)
    partner_type = Column(String(30), nullable=False, default="A")  # A | B | C
    manager_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    status = Column(String(20), nullable=False, default="active")  # active / paused / archive
    comment = Column(Text, nullable=True)
    cooperation_start_date = Column(Date, nullable=True)
    client_joined_date = Column(Date, nullable=True)
    is_deleted = Column(Boolean, default=False)
    trashed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    manager = relationship("User", back_populates="managed_partners")
    payments = relationship("Payment", back_populates="partner")
