"""Фиксация сумм зарплатного фонда для P&L: курс и UZS на момент выплаты, без пересчёта при смене курса в «Доступные средства»."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Optional, Tuple

from sqlalchemy.orm import Session

from app.models.available_funds_manual import AvailableFundsManual


def _anchor_month_key(d: date) -> str:
    return f"{d.year}-{d.month:02d}"


def compute_payroll_pl_lock_uzs(
    db: Session,
    company_slug: str,
    currency: str,
    net_for_pl: Decimal,
    rate_anchor_date: date,
) -> Tuple[Optional[Decimal], Optional[Decimal]]:
    """
    Возвращает (locked_uzs, usd_to_uzs_rate_applied).
    UZS: (net, None) — курс не применялся.
    USD: при rate > 0 — (net * rate, rate); иначе (None, None) — в P&L остаётся динамическая конвертация по курсу месяца колонки.
    """
    net = net_for_pl.quantize(Decimal("0.01"))
    if net <= 0:
        return Decimal("0"), None
    cur = (currency or "USD").upper()
    if cur == "UZS":
        return net, None
    if cur != "USD":
        return None, None
    ym = _anchor_month_key(rate_anchor_date)
    row = (
        db.query(AvailableFundsManual)
        .filter(
            AvailableFundsManual.company_slug == company_slug,
            AvailableFundsManual.period_month == ym,
        )
        .first()
    )
    rate = Decimal(str(row.usd_to_uzs_rate or 0)) if row else Decimal(0)
    if rate <= 0:
        return None, None
    locked = (net * rate).quantize(Decimal("0.01"))
    return locked, rate.quantize(Decimal("0.0001"))


def paid_at_to_date(paid_at: Optional[datetime], fallback: date) -> date:
    if paid_at is None:
        return fallback
    if isinstance(paid_at, datetime):
        return paid_at.date()
    return fallback  # type: ignore[unreachable]


def sync_employee_task_pl_fx_lock(db: Session, t, *, refresh: bool = True) -> None:
    """Вызывать перед commit. refresh=True — пересчитать сумму (новая оплата или смена суммы/привязки)."""
    if not getattr(t, "paid", False):
        t.pl_salary_uzs_locked = None
        t.pl_usd_to_uzs_rate_applied = None
        return
    if not (getattr(t, "allocated_payment_id", None) and getattr(t, "cost_category", None)):
        t.pl_salary_uzs_locked = None
        t.pl_usd_to_uzs_rate_applied = None
        return
    if (
        not refresh
        and getattr(t, "pl_salary_uzs_locked", None) is not None
    ):
        return
    if (
        not refresh
        and (str(getattr(t, "currency", None) or "USD")).upper() == "USD"
        and getattr(t, "pl_salary_uzs_locked", None) is None
        and getattr(t, "pl_usd_to_uzs_rate_applied", None) is None
    ):
        return
    amt = Decimal(str(t.amount or 0))
    bud = Decimal(str(t.budget_amount or 0))
    net = amt - bud
    if net <= 0:
        t.pl_salary_uzs_locked = Decimal("0")
        t.pl_usd_to_uzs_rate_applied = None
        return
    anchor = paid_at_to_date(getattr(t, "paid_at", None), t.work_date)
    locked, rate = compute_payroll_pl_lock_uzs(
        db,
        str(t.company_slug),
        str(t.currency or "USD"),
        net,
        anchor,
    )
    t.pl_salary_uzs_locked = locked
    t.pl_usd_to_uzs_rate_applied = rate


def sync_employee_payment_record_pl_fx_lock(db: Session, r) -> None:
    """На момент создания записи в «История выплат» фиксируем сумму для строки P&L «Зарплатный фонд»."""
    amt = Decimal(str(r.amount or 0))
    bud = Decimal(str(getattr(r, "budget_amount", 0) or 0))
    net = amt - bud
    if net < 0:
        net = Decimal(0)
    if net <= 0:
        r.pl_salary_uzs_locked = Decimal("0")
        r.pl_usd_to_uzs_rate_applied = None
        return
    py, pm = getattr(r, "period_year", None), getattr(r, "period_month", None)
    if py is not None and pm is not None and 1 <= int(pm) <= 12:
        anchor = date(int(py), int(pm), 1)
    else:
        anchor = r.paid_on
    locked, rate = compute_payroll_pl_lock_uzs(
        db,
        str(r.company_slug),
        str(r.currency or "USD"),
        net,
        anchor,
    )
    r.pl_salary_uzs_locked = locked
    r.pl_usd_to_uzs_rate_applied = rate
