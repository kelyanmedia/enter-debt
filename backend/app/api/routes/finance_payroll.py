"""Зарплатный фонд: сотрудники, ведомость по месяцам, отметка «Оплачено» → строка ДДС."""
from __future__ import annotations

import re
from datetime import date
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.core.security import require_finance_section
from app.db.database import get_db, get_request_company
from app.models.cash_flow import CashFlowEntry
from app.models.payroll import PayrollEmployee, PayrollEntry
from app.models.user import User
from app.schemas.schemas import (
    PayrollEmployeeCreate,
    PayrollEmployeeOut,
    PayrollEmployeeUpdate,
    PayrollEntryCreate,
    PayrollEntryOut,
    PayrollEntryUpdate,
    PayrollGenerateIn,
)
from app.services.payroll_cash_flow import payroll_entry_total, sync_payroll_cash_flow

router = APIRouter(prefix="/api/finance", tags=["finance"])
# Выплаты зарплат пишутся в ДДС — доступ тот же, что к ДДС
require_payroll_access = require_finance_section("cashflow")

_YM = re.compile(r"^\d{4}-\d{2}$")


def _clean_card_number(raw: Optional[str]) -> Optional[str]:
    if raw is None:
        return None
    digits = re.sub(r"\D", "", raw)
    if not digits:
        return None
    if len(digits) != 16:
        raise HTTPException(status_code=400, detail="Номер карты должен содержать ровно 16 цифр")
    return digits


def _clean_name_part(raw: Optional[str]) -> Optional[str]:
    if raw is None:
        return None
    return " ".join(raw.split()) or None


def _previous_month(period_month: str) -> str:
    y, m = (int(x) for x in period_month.split("-"))
    if m == 1:
        return f"{y - 1:04d}-12"
    return f"{y:04d}-{m - 1:02d}"


def _get_employee(db: Session, employee_id: int) -> PayrollEmployee:
    emp = (
        db.query(PayrollEmployee)
        .filter(PayrollEmployee.id == employee_id, PayrollEmployee.company_slug == get_request_company())
        .first()
    )
    if not emp:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    return emp


def _get_entry(db: Session, entry_id: int) -> PayrollEntry:
    row = (
        db.query(PayrollEntry)
        .options(joinedload(PayrollEntry.employee))
        .filter(PayrollEntry.id == entry_id, PayrollEntry.company_slug == get_request_company())
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Строка ведомости не найдена")
    return row


def _cash_flow_ids(db: Session, entry_ids: List[int]) -> Dict[int, int]:
    if not entry_ids:
        return {}
    rows = (
        db.query(CashFlowEntry.payroll_entry_id, CashFlowEntry.id)
        .filter(
            CashFlowEntry.payroll_entry_id.in_(entry_ids),
            CashFlowEntry.company_slug == get_request_company(),
        )
        .all()
    )
    return {int(pid): int(cid) for pid, cid in rows}


def _entry_out(row: PayrollEntry, cash_flow_id: Optional[int]) -> PayrollEntryOut:
    emp = row.employee
    return PayrollEntryOut(
        id=int(row.id),
        period_month=row.period_month,
        employee_id=int(row.employee_id),
        employee_name=emp.full_name if emp else "—",
        employee_active=bool(emp.is_active) if emp else False,
        position=row.position,
        department=emp.department if emp else None,
        employment_type=(emp.employment_type if emp else None) or "inhouse",
        currency=row.currency,
        base_amount=row.base_amount or 0,
        bonus_amount=row.bonus_amount or 0,
        bonus_note=row.bonus_note,
        deduction_amount=row.deduction_amount or 0,
        deduction_note=row.deduction_note,
        total_amount=payroll_entry_total(row),
        payment_method=row.payment_method,
        card_number=emp.card_number if emp else None,
        card_holder_first_name=emp.card_holder_first_name if emp else None,
        card_holder_last_name=emp.card_holder_last_name if emp else None,
        bank_name=emp.bank_name if emp else None,
        phone=emp.phone if emp else None,
        pay_day=emp.pay_day if emp else None,
        paid=bool(row.paid),
        paid_on=row.paid_on,
        cash_flow_entry_id=cash_flow_id,
        note=row.note,
    )


def _single_entry_out(db: Session, row: PayrollEntry) -> PayrollEntryOut:
    return _entry_out(row, _cash_flow_ids(db, [int(row.id)]).get(int(row.id)))


def _new_entry_for(
    employee: PayrollEmployee,
    period_month: str,
    previous: Optional[PayrollEntry] = None,
) -> PayrollEntry:
    """Новая строка месяца: из предыдущего месяца (оклад/бонус) либо из карточки сотрудника."""
    if previous is not None:
        return PayrollEntry(
            company_slug=employee.company_slug,
            period_month=period_month,
            employee_id=employee.id,
            position=employee.position or previous.position,
            currency=previous.currency,
            base_amount=previous.base_amount,
            bonus_amount=previous.bonus_amount,
            bonus_note=previous.bonus_note,
            deduction_amount=0,
            payment_method=previous.payment_method,
            paid=False,
        )
    return PayrollEntry(
        company_slug=employee.company_slug,
        period_month=period_month,
        employee_id=employee.id,
        position=employee.position,
        currency=employee.currency or "UZS",
        base_amount=employee.base_salary or 0,
        bonus_amount=0,
        deduction_amount=0,
        payment_method=employee.payment_method or "card",
        paid=False,
    )


# ── Сотрудники ────────────────────────────────────────────────────────────────


@router.get("/payroll/employees", response_model=List[PayrollEmployeeOut])
def list_payroll_employees(
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
    _: User = Depends(require_payroll_access),
):
    q = db.query(PayrollEmployee).filter(PayrollEmployee.company_slug == get_request_company())
    if not include_inactive:
        q = q.filter(PayrollEmployee.is_active == True)  # noqa: E712
    return q.order_by(PayrollEmployee.sort_order.asc(), PayrollEmployee.full_name.asc()).all()


@router.post("/payroll/employees", response_model=PayrollEmployeeOut)
def create_payroll_employee(
    body: PayrollEmployeeCreate,
    period_month: Optional[str] = Query(None, description="Сразу добавить сотрудника в ведомость этого месяца"),
    db: Session = Depends(get_db),
    _: User = Depends(require_payroll_access),
):
    data = body.model_dump()
    data["full_name"] = data["full_name"].strip()
    data["card_number"] = _clean_card_number(data.get("card_number"))
    for k in ("card_holder_first_name", "card_holder_last_name"):
        data[k] = _clean_name_part(data.get(k))
    slug = get_request_company()
    max_sort = (
        db.query(PayrollEmployee.sort_order)
        .filter(PayrollEmployee.company_slug == slug)
        .order_by(PayrollEmployee.sort_order.desc())
        .first()
    )
    emp = PayrollEmployee(company_slug=slug, sort_order=(max_sort[0] + 1) if max_sort else 0, is_active=True, **data)
    db.add(emp)
    db.flush()
    if period_month:
        if not _YM.match(period_month):
            raise HTTPException(status_code=400, detail="period_month: формат YYYY-MM")
        db.add(_new_entry_for(emp, period_month))
    db.commit()
    db.refresh(emp)
    return emp


@router.patch("/payroll/employees/{employee_id}", response_model=PayrollEmployeeOut)
def update_payroll_employee(
    employee_id: int,
    body: PayrollEmployeeUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_payroll_access),
):
    emp = _get_employee(db, employee_id)
    patch = body.model_dump(exclude_unset=True)
    if "full_name" in patch and patch["full_name"] is not None:
        patch["full_name"] = patch["full_name"].strip()
    if "card_number" in patch:
        patch["card_number"] = _clean_card_number(patch["card_number"])
    for k in ("card_holder_first_name", "card_holder_last_name"):
        if k in patch:
            patch[k] = _clean_name_part(patch[k])
    for k, v in patch.items():
        setattr(emp, k, v)
    # Имя/должность в ДДС-строках уже оплаченных месяцев обновляем, чтобы ДДС не расходился с ведомостью
    if "full_name" in patch:
        db.flush()
        for entry in db.query(PayrollEntry).filter(PayrollEntry.employee_id == emp.id, PayrollEntry.paid == True).all():  # noqa: E712
            sync_payroll_cash_flow(db, entry)
    db.commit()
    db.refresh(emp)
    return emp


@router.delete("/payroll/employees/{employee_id}")
def archive_payroll_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_payroll_access),
):
    """Уволить: сотрудник скрывается из новых месяцев, история выплат и ДДС сохраняются."""
    emp = _get_employee(db, employee_id)
    emp.is_active = False
    db.commit()
    return {"ok": True, "archived": True}


# ── Ведомость ────────────────────────────────────────────────────────────────


@router.get("/payroll/entries", response_model=List[PayrollEntryOut])
def list_payroll_entries(
    period_month: str = Query(..., description="YYYY-MM"),
    db: Session = Depends(get_db),
    _: User = Depends(require_payroll_access),
):
    if not _YM.match(period_month):
        raise HTTPException(status_code=400, detail="period_month: формат YYYY-MM")
    rows = (
        db.query(PayrollEntry)
        .options(joinedload(PayrollEntry.employee))
        .join(PayrollEmployee, PayrollEmployee.id == PayrollEntry.employee_id)
        .filter(
            PayrollEntry.period_month == period_month,
            PayrollEntry.company_slug == get_request_company(),
        )
        .order_by(PayrollEmployee.sort_order.asc(), PayrollEmployee.full_name.asc())
        .all()
    )
    cf = _cash_flow_ids(db, [int(r.id) for r in rows])
    return [_entry_out(r, cf.get(int(r.id))) for r in rows]


@router.post("/payroll/generate", response_model=List[PayrollEntryOut])
def generate_payroll_month(
    body: PayrollGenerateIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_payroll_access),
):
    """Добавить в месяц всех активных сотрудников, которых там ещё нет. Существующие строки не трогаем."""
    slug = get_request_company()
    employees = (
        db.query(PayrollEmployee)
        .filter(PayrollEmployee.company_slug == slug, PayrollEmployee.is_active == True)  # noqa: E712
        .all()
    )
    existing_ids = {
        int(eid)
        for (eid,) in db.query(PayrollEntry.employee_id)
        .filter(PayrollEntry.company_slug == slug, PayrollEntry.period_month == body.period_month)
        .all()
    }
    previous: Dict[int, PayrollEntry] = {}
    if body.copy_from_previous:
        prev_month = _previous_month(body.period_month)
        previous = {
            int(r.employee_id): r
            for r in db.query(PayrollEntry)
            .filter(PayrollEntry.company_slug == slug, PayrollEntry.period_month == prev_month)
            .all()
        }
    for emp in employees:
        if int(emp.id) in existing_ids:
            continue
        db.add(_new_entry_for(emp, body.period_month, previous.get(int(emp.id))))
    db.commit()
    return list_payroll_entries(body.period_month, db=db, _=_)


@router.post("/payroll/entries", response_model=PayrollEntryOut)
def create_payroll_entry(
    body: PayrollEntryCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_payroll_access),
):
    emp = _get_employee(db, body.employee_id)
    dup = (
        db.query(PayrollEntry)
        .filter(
            PayrollEntry.company_slug == get_request_company(),
            PayrollEntry.period_month == body.period_month,
            PayrollEntry.employee_id == emp.id,
        )
        .first()
    )
    if dup:
        raise HTTPException(status_code=400, detail="Сотрудник уже есть в ведомости этого месяца")
    row = _new_entry_for(emp, body.period_month)
    db.add(row)
    db.commit()
    return _single_entry_out(db, _get_entry(db, int(row.id)))


@router.patch("/payroll/entries/{entry_id}", response_model=PayrollEntryOut)
def update_payroll_entry(
    entry_id: int,
    body: PayrollEntryUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_payroll_access),
):
    row = _get_entry(db, entry_id)
    patch = body.model_dump(exclude_unset=True)
    for k, v in patch.items():
        setattr(row, k, v)
    if row.paid and row.paid_on is None:
        row.paid_on = date.today()
    if not row.paid:
        row.paid_on = None
    db.flush()
    sync_payroll_cash_flow(db, row)
    db.commit()
    return _single_entry_out(db, _get_entry(db, entry_id))


@router.delete("/payroll/entries/{entry_id}")
def delete_payroll_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_payroll_access),
):
    row = _get_entry(db, entry_id)
    if row.paid:
        raise HTTPException(
            status_code=400,
            detail="Строка отмечена как оплаченная и уже в ДДС. Сначала снимите галочку «Оплачено».",
        )
    db.delete(row)
    db.commit()
    return {"ok": True}
