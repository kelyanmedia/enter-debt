from sqlalchemy import Column, Integer, String, Numeric, Boolean, Date, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.database import Base


class Commission(Base):
    __tablename__ = "commissions"

    id = Column(Integer, primary_key=True, index=True)
    project_name = Column(String(300), nullable=False)
    project_type = Column(String(20), nullable=False)          # site | seo | ppc
    project_cost = Column(Numeric(15, 2), nullable=False)      # Стоимость проекта
    production_cost = Column(Numeric(15, 2), nullable=False, default=0)  # Себестоимость
    manager_percent = Column(Numeric(5, 2), nullable=False)    # % менеджера (1-20)
    actual_payment = Column(Numeric(15, 2), nullable=True)     # Оплата фактическая
    received_amount_1 = Column(Numeric(15, 2), nullable=True)  # Полученный % (1)
    received_amount_2 = Column(Numeric(15, 2), nullable=True)  # Полученный % (2)
    # Месяц отражения в P&L (строка «Процент менеджера»): касса по факту; без даты — project_date
    received_amount_1_on = Column(Date, nullable=True)
    received_amount_2_on = Column(Date, nullable=True)
    commission_paid_full = Column(Boolean, nullable=False, default=False)
    project_date = Column(Date, nullable=False)                # Дата проекта (для фильтров)
    note = Column(String(500), nullable=True)

    manager_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    payment_id = Column(Integer, ForeignKey("payments.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    manager = relationship("User", foreign_keys=[manager_id])
    payment = relationship("Payment", foreign_keys=[payment_id])
