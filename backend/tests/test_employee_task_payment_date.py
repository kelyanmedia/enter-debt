"""Дата выплаты задачи определяет месяц ДДС и может быть исправлена."""
from __future__ import annotations

import os
import sys
from datetime import date
from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app.main  # noqa: F401 — регистрирует модели
from app.api.routes import employee_tasks
from app.db.database import Base, reset_company_context, set_company_context
from app.models.cash_flow import CashFlowEntry
from app.models.employee_task import EmployeeTask
from app.models.user import User
from app.schemas.schemas import EmployeeTaskUpdate


def test_paid_task_date_moves_cash_flow_to_selected_month():
    token = set_company_context("kelyanmedia")
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    try:
        admin = User(company_slug="kelyanmedia", name="Админ", email="staff-paid-date@example.test", hashed_password="test", role="admin", is_active=True)
        employee = User(company_slug="kelyanmedia", name="Сотрудник", email="staff-paid-date-employee@example.test", hashed_password="test", role="employee", is_active=True)
        db.add_all((admin, employee))
        db.flush()
        task = EmployeeTask(
            company_slug="kelyanmedia",
            user_id=employee.id,
            work_date=date(2026, 8, 20),
            project_name="Проект",
            task_description="Задача",
            amount=Decimal("500"),
            currency="USD",
            status="done",
            paid=False,
        )
        db.add(task)
        db.commit()

        employee_tasks.update_task(task.id, EmployeeTaskUpdate(paid=True, paid_at=date(2026, 7, 31)), db=db, current_user=admin)
        task = db.query(EmployeeTask).filter(EmployeeTask.id == task.id).one()
        cash = db.query(CashFlowEntry).filter(CashFlowEntry.employee_task_id == task.id).one()
        assert task.paid_at.date() == date(2026, 7, 31)
        assert cash.period_month == "2026-07"
        assert cash.entry_date == date(2026, 7, 31)

        employee_tasks.update_task(task.id, EmployeeTaskUpdate(paid_at=date(2026, 8, 2)), db=db, current_user=admin)
        cash = db.query(CashFlowEntry).filter(CashFlowEntry.employee_task_id == task.id).one()
        assert cash.period_month == "2026-08"
        assert cash.entry_date == date(2026, 8, 2)
    finally:
        db.close()
        Base.metadata.drop_all(engine)
        reset_company_context(token)
