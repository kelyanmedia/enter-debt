"""Зеркало оплаченной строки зарплатного фонда в ДДС (расход, категория «Зарплата»)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from app.models.cash_flow import CashFlowEntry
from app.models.payroll import PayrollEntry


def payroll_entry_total(e: PayrollEntry) -> Decimal:
    """К выплате = оклад + бонус − удержания (не ниже нуля)."""
    total = (
        Decimal(str(e.base_amount or 0))
        + Decimal(str(e.bonus_amount or 0))
        - Decimal(str(e.deduction_amount or 0))
    )
    return total.quantize(Decimal("0.01")) if total > 0 else Decimal("0")


def _find_payroll_cash_flow(db: Session, e: PayrollEntry) -> Optional[CashFlowEntry]:
    return (
        db.query(CashFlowEntry)
        .filter(
            CashFlowEntry.payroll_entry_id == e.id,
            CashFlowEntry.company_slug == e.company_slug,
        )
        .first()
    )


def sync_payroll_cash_flow(db: Session, e: PayrollEntry) -> None:
    """Создать/обновить/удалить строку ДДС при смене «Оплачено», суммы или даты."""
    existing = _find_payroll_cash_flow(db, e)
    total = payroll_entry_total(e)
    if not e.paid or total <= 0:
        if existing is not None:
            db.delete(existing)
        return

    paid_on: date = e.paid_on or date.today()
    emp = e.employee
    name = (emp.full_name if emp else "").strip() or "Сотрудник"
    position = (e.position or (emp.position if emp else "") or "").strip()
    label = f"Зарплата: {name}"
    if position:
        label = f"{label} — {position}"

    notes_parts = [f"Зарплатный фонд за {e.period_month}"]
    if Decimal(str(e.bonus_amount or 0)) > 0:
        bonus = f"бонус {Decimal(str(e.bonus_amount)).normalize():f}"
        if (e.bonus_note or "").strip():
            bonus = f"{bonus} ({e.bonus_note.strip()})"
        notes_parts.append(bonus)
    if Decimal(str(e.deduction_amount or 0)) > 0:
        notes_parts.append(f"удержано {Decimal(str(e.deduction_amount)).normalize():f}")
    notes = ". ".join(notes_parts)

    is_usd = (e.currency or "UZS").upper() == "USD"
    fields = {
        # В ДДС расход живёт в месяце фактической оплаты (как и задачи команды)
        "period_month": f"{paid_on.year:04d}-{paid_on.month:02d}",
        "entry_date": paid_on,
        "direction": "expense",
        "label": label[:300],
        "amount_uzs": Decimal("0") if is_usd else total,
        "amount_usd": total if is_usd else Decimal("0"),
        "apply_fx_to_uzs": False,
        "payment_method": e.payment_method or "card",
        "flow_category": "salary",
        "recipient": name[:120],
        "payment_id": None,
        "cost_category": None,
        "notes": notes[:500],
        "template_line_id": None,
    }

    if existing is not None:
        for k, v in fields.items():
            setattr(existing, k, v)
        return

    db.add(CashFlowEntry(company_slug=e.company_slug, payroll_entry_id=e.id, created_by_user_id=None, **fields))
