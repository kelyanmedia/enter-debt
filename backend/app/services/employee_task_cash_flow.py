"""Зеркало оплаченной задачи команды в ДДС (история расхода); в P&L не дублируется."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional, Tuple

from sqlalchemy.orm import Session

from app.models.cash_flow import CashFlowEntry
from app.models.employee_task import EmployeeTask
from app.models.user import User


def _task_net_amount(t: EmployeeTask) -> Decimal:
    amt = Decimal(str(t.amount or 0))
    bud = Decimal(str(t.budget_amount or 0))
    net = amt - bud
    return net.quantize(Decimal("0.01")) if net > 0 else Decimal("0")


def _task_dds_flow_category(t: EmployeeTask) -> str:
    cat = (t.cost_category or "").strip().lower()
    if cat == "contractor":
        return "contractor"
    return "salary"


def _task_dds_amounts(t: EmployeeTask) -> Tuple[Decimal, Decimal]:
    net = _task_net_amount(t)
    cur = (t.currency or "USD").upper()
    if cur == "UZS":
        return net, Decimal("0")
    return Decimal("0"), net


def _find_task_cash_flow(db: Session, t: EmployeeTask) -> Optional[CashFlowEntry]:
    return (
        db.query(CashFlowEntry)
        .filter(
            CashFlowEntry.employee_task_id == t.id,
            CashFlowEntry.company_slug == t.company_slug,
        )
        .first()
    )


def sync_employee_task_cash_flow(db: Session, t: EmployeeTask, *, owner: Optional[User] = None) -> None:
    """Создать/обновить/удалить строку ДДС при смене «Оплачено» или суммы."""
    existing = _find_task_cash_flow(db, t)
    if not t.paid:
        if existing is not None:
            db.delete(existing)
        return

    net = _task_net_amount(t)
    if net <= 0:
        if existing is not None:
            db.delete(existing)
        return

    paid_dt = t.paid_at.date() if isinstance(t.paid_at, datetime) else (t.paid_at or t.work_date)
    period_month = f"{paid_dt.year:04d}-{paid_dt.month:02d}"
    amount_uzs, amount_usd = _task_dds_amounts(t)

    pay_id = t.allocated_payment_id if (t.allocated_payment_id and t.cost_category) else None
    cost_cat = (t.cost_category or "").strip().lower() if pay_id else None

    if owner is None:
        owner = db.query(User).filter(User.id == t.user_id).first()
    recipient = (owner.name if owner else "").strip() or None
    proj = (t.project_name or "").strip() or "—"
    desc = (t.task_description or "").strip()
    if len(desc) > 80:
        desc = desc[:77] + "…"
    label = f"Команда: {proj}"
    if desc:
        label = f"{label} — {desc}"

    notes_parts = [f"Задача команды #{t.id}"]
    if pay_id and cost_cat:
        notes_parts.append(f"Projects Cost: проект #{pay_id}, статья {cost_cat}")
    else:
        notes_parts.append("Без привязки к Projects Cost")
    notes = ". ".join(notes_parts)

    fields = {
        "period_month": period_month,
        "entry_date": paid_dt,
        "direction": "expense",
        "label": label[:300],
        "amount_uzs": amount_uzs,
        "amount_usd": amount_usd,
        "apply_fx_to_uzs": False,
        "payment_method": "transfer",
        "flow_category": _task_dds_flow_category(t),
        "recipient": recipient,
        "payment_id": pay_id,
        "cost_category": cost_cat,
        "notes": notes[:500],
        "template_line_id": None,
    }

    if existing is not None:
        for k, v in fields.items():
            setattr(existing, k, v)
        return

    row = CashFlowEntry(
        company_slug=t.company_slug,
        employee_task_id=t.id,
        created_by_user_id=None,
        **fields,
    )
    db.add(row)
