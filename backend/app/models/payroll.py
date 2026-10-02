"""Зарплатный фонд: справочник сотрудников и ведомость выплат по месяцам."""

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class PayrollEmployee(Base):
    """Сотрудник в зарплатном фонде — постоянные данные (оклад по умолчанию, реквизиты)."""

    __tablename__ = "payroll_employees"

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True)
    # Необязательная привязка к пользователю панели (сотрудник может и не иметь логина)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    full_name = Column(String(200), nullable=False)
    position = Column(String(200), nullable=True)
    department = Column(String(120), nullable=True)
    # inhouse — штатный сотрудник, outsource — внешний исполнитель
    employment_type = Column(String(16), nullable=False, default="inhouse")
    base_salary = Column(Numeric(15, 2), nullable=False, default=0)
    currency = Column(String(3), nullable=False, default="UZS")
    # cash | card | transfer — как в справочнике ДДС
    payment_method = Column(String(20), nullable=False, default="card")
    card_number = Column(String(32), nullable=True)
    # Имя и фамилия держателя отдельно — в банковских приложениях их часто вводят в разные поля
    card_holder_first_name = Column(String(100), nullable=True)
    card_holder_last_name = Column(String(100), nullable=True)
    bank_name = Column(String(120), nullable=True)
    phone = Column(String(40), nullable=True)
    # День месяца, к которому обычно выплачивается зарплата (подсказка в ведомости)
    pay_day = Column(Integer, nullable=True)
    hired_on = Column(Date, nullable=True)
    note = Column(Text, nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    # Уволенные остаются в истории выплат, но не попадают в новые месяцы
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User", foreign_keys=[user_id])


class PayrollEntry(Base):
    """Строка ведомости: выплата сотруднику за месяц. «Оплачено» зеркалится в ДДС."""

    __tablename__ = "payroll_entries"
    __table_args__ = (
        UniqueConstraint("company_slug", "period_month", "employee_id", name="uq_payroll_entry_month_employee"),
    )

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True)
    period_month = Column(String(7), nullable=False, index=True)  # YYYY-MM — за какой месяц зарплата
    employee_id = Column(
        Integer, ForeignKey("payroll_employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Снимок на момент месяца: позиция могла смениться позже
    position = Column(String(200), nullable=True)
    currency = Column(String(3), nullable=False, default="UZS")
    base_amount = Column(Numeric(15, 2), nullable=False, default=0)
    bonus_amount = Column(Numeric(15, 2), nullable=False, default=0)
    bonus_note = Column(String(300), nullable=True)  # «5% от продаж», «KPI» и т.п.
    deduction_amount = Column(Numeric(15, 2), nullable=False, default=0)  # аванс, штраф, удержание
    deduction_note = Column(String(300), nullable=True)
    payment_method = Column(String(20), nullable=False, default="card")
    paid = Column(Boolean, nullable=False, default=False)
    paid_on = Column(Date, nullable=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    employee = relationship("PayrollEmployee")
