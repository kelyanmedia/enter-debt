from sqlalchemy import Boolean, Column, Integer, String, Date, DateTime, Numeric, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class EmployeeTask(Base):
    __tablename__ = "employee_tasks"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    work_date = Column(Date, nullable=False)
    project_name = Column(String(300), nullable=False)
    task_description = Column(String(600), nullable=False)
    task_url = Column(String(800), nullable=True)
    hours = Column(Numeric(10, 2), nullable=True)
    amount = Column(Numeric(15, 2), nullable=True)
    # Проходные средства клиента (реклама и т.п.): не расход компании, не в P&L при корректной выплате
    budget_amount = Column(Numeric(15, 2), nullable=True)
    currency = Column(String(3), nullable=False, default="USD")
    status = Column(String(30), nullable=False, default="not_started")
    paid = Column(Boolean, nullable=False, default=False)
    paid_at = Column(DateTime(timezone=True), nullable=True)
    done_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User", back_populates="employee_tasks")
