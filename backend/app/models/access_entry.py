from sqlalchemy import Column, Integer, String, DateTime, Text, SmallInteger, Boolean
from sqlalchemy.sql import func

from app.db.database import Base


class AccessEntry(Base):
    __tablename__ = "access_entries"

    id = Column(Integer, primary_key=True, index=True)
    employee_name = Column(String(160), nullable=False, index=True)
    category = Column(String(24), nullable=False, index=True)  # email | telegram | device | service
    title = Column(String(220), nullable=False)
    service_type = Column(String(120), nullable=True)
    shared_with_administration = Column(Boolean, nullable=False, default=False)
    login = Column(String(320), nullable=True)
    password = Column(Text, nullable=True)
    phone_number = Column(String(40), nullable=True)
    twofa_code = Column(String(120), nullable=True)
    reserve_email = Column(String(220), nullable=True)
    device_model = Column(String(220), nullable=True)
    serial_number = Column(String(220), nullable=True)
    charge_cycles = Column(SmallInteger, nullable=True)
    photo_url = Column(String(900), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
