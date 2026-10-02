"""Зарплатный фонд: ведомость месяца и зеркало «Оплачено» в ДДС."""
from __future__ import annotations

import os
import sys
from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app.main  # noqa: F401,E402 — регистрирует все модели в Base.metadata
from app.api.routes import finance_payroll as fp  # noqa: E402
from app.db.database import Base  # noqa: E402
from app.models.cash_flow import CashFlowEntry  # noqa: E402
from app.schemas.schemas import (  # noqa: E402
    PayrollEmployeeCreate,
    PayrollEntryUpdate,
    PayrollGenerateIn,
)

USER = object()


@pytest.fixture()
def db(monkeypatch):
    engine = create_engine("sqlite://")
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    monkeypatch.setattr(fp, "get_request_company", lambda: "kelyanmedia")
    try:
        yield session
    finally:
        session.close()


def _employee(db, **kw):
    body = PayrollEmployeeCreate(
        full_name=kw.get("full_name", "Иван Петров"),
        position=kw.get("position", "Дизайнер"),
        base_salary=kw.get("base_salary", Decimal("5000000")),
        currency=kw.get("currency", "UZS"),
        card_number=kw.get("card_number", "8600 1234 5678 9012"),
    )
    return fp.create_payroll_employee(body, period_month=kw.get("period_month"), db=db, _=USER)


def _cash_flow_rows(db):
    return db.query(CashFlowEntry).filter(CashFlowEntry.payroll_entry_id.isnot(None)).all()


def test_card_number_is_stored_as_digits(db):
    emp = _employee(db)
    assert emp.card_number == "8600123456789012"


@pytest.mark.parametrize("card", ["8600 1234 5678 901", "8600 1234 5678 9012 3"])
def test_card_number_must_have_16_digits(db, card):
    with pytest.raises(HTTPException) as exc:
        _employee(db, card_number=card)
    assert "16 цифр" in exc.value.detail


def test_card_holder_name_parts_are_separate_and_trimmed(db):
    body = PayrollEmployeeCreate(
        full_name="Иван Петров",
        card_holder_first_name="  IVAN ",
        card_holder_last_name="PETROV",
    )
    emp = fp.create_payroll_employee(body, period_month="2026-10", db=db, _=USER)
    assert (emp.card_holder_first_name, emp.card_holder_last_name) == ("IVAN", "PETROV")
    [entry] = fp.list_payroll_entries("2026-10", db=db, _=USER)
    assert (entry.card_holder_first_name, entry.card_holder_last_name) == ("IVAN", "PETROV")


def test_employment_type_defaults_to_inhouse_and_reaches_entries(db):
    inhouse = _employee(db, period_month="2026-10")
    assert inhouse.employment_type == "inhouse"
    body = PayrollEmployeeCreate(full_name="Внешний SEO", employment_type="outsource")
    fp.create_payroll_employee(body, period_month="2026-10", db=db, _=USER)
    types = {e.employee_name: e.employment_type for e in fp.list_payroll_entries("2026-10", db=db, _=USER)}
    assert types == {"Иван Петров": "inhouse", "Внешний SEO": "outsource"}


def test_paid_entry_creates_salary_cash_flow_and_unpaid_removes_it(db):
    _employee(db, period_month="2026-10")
    [entry] = fp.list_payroll_entries("2026-10", db=db, _=USER)
    assert entry.base_amount == Decimal("5000000")
    assert entry.card_number == "8600123456789012"

    out = fp.update_payroll_entry(
        entry.id,
        PayrollEntryUpdate(
            bonus_amount=Decimal("1000000"),
            bonus_note="5% от продаж",
            deduction_amount=Decimal("500000"),
            paid=True,
            paid_on=date(2026, 11, 5),
        ),
        db=db,
        _=USER,
    )
    assert out.total_amount == Decimal("5500000.00")
    assert out.cash_flow_entry_id is not None

    [cf] = _cash_flow_rows(db)
    assert cf.direction == "expense"
    assert cf.flow_category == "salary"
    assert cf.amount_uzs == Decimal("5500000.00")
    assert cf.amount_usd == Decimal("0")
    # Расход в ДДС — в месяце фактической оплаты
    assert cf.period_month == "2026-11"
    assert cf.recipient == "Иван Петров"
    assert "Иван Петров" in cf.label

    out = fp.update_payroll_entry(entry.id, PayrollEntryUpdate(paid=False), db=db, _=USER)
    assert out.paid_on is None
    assert out.cash_flow_entry_id is None
    assert _cash_flow_rows(db) == []


def test_usd_salary_goes_to_usd_column(db):
    _employee(db, currency="USD", base_salary=Decimal("800"), period_month="2026-10")
    [entry] = fp.list_payroll_entries("2026-10", db=db, _=USER)
    fp.update_payroll_entry(entry.id, PayrollEntryUpdate(paid=True), db=db, _=USER)
    [cf] = _cash_flow_rows(db)
    assert cf.amount_usd == Decimal("800.00")
    assert cf.amount_uzs == Decimal("0")


def test_amount_change_after_payment_updates_cash_flow(db):
    _employee(db, period_month="2026-10")
    [entry] = fp.list_payroll_entries("2026-10", db=db, _=USER)
    fp.update_payroll_entry(entry.id, PayrollEntryUpdate(paid=True), db=db, _=USER)
    fp.update_payroll_entry(entry.id, PayrollEntryUpdate(base_amount=Decimal("6000000")), db=db, _=USER)
    [cf] = _cash_flow_rows(db)
    assert cf.amount_uzs == Decimal("6000000.00")


def test_paid_entry_cannot_be_deleted(db):
    _employee(db, period_month="2026-10")
    [entry] = fp.list_payroll_entries("2026-10", db=db, _=USER)
    fp.update_payroll_entry(entry.id, PayrollEntryUpdate(paid=True), db=db, _=USER)
    with pytest.raises(HTTPException):
        fp.delete_payroll_entry(entry.id, db=db, _=USER)


def test_generate_copies_previous_month_and_skips_fired(db):
    emp = _employee(db, period_month="2026-09")
    [sep] = fp.list_payroll_entries("2026-09", db=db, _=USER)
    fp.update_payroll_entry(
        sep.id,
        PayrollEntryUpdate(bonus_amount=Decimal("700000"), deduction_amount=Decimal("100000"), paid=True),
        db=db,
        _=USER,
    )
    fired = _employee(db, full_name="Уволенный")
    fp.archive_payroll_employee(fired.id, db=db, _=USER)

    rows = fp.generate_payroll_month(PayrollGenerateIn(period_month="2026-10"), db=db, _=USER)
    assert [r.employee_id for r in rows] == [emp.id]
    [oct_row] = rows
    assert oct_row.bonus_amount == Decimal("700000")
    assert oct_row.deduction_amount == Decimal("0")  # удержания разовые, не переносятся
    assert oct_row.paid is False

    # Повторное формирование не дублирует строки
    again = fp.generate_payroll_month(PayrollGenerateIn(period_month="2026-10"), db=db, _=USER)
    assert len(again) == 1


def test_previous_month_wraps_year():
    assert fp._previous_month("2026-01") == "2025-12"
    assert fp._previous_month("2026-10") == "2026-09"
