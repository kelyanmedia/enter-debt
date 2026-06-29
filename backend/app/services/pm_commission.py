"""Расчёт комиссии проектного менеджера (ПМ) по закрытым проектам."""
from __future__ import annotations

import calendar
import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models.payment import Payment, PaymentMonth


def _add_calendar_months(d: date, n: int) -> date:
    if n <= 0:
        return d
    y, m = d.year, d.month + n
    while m > 12:
        m -= 12
        y += 1
    while m < 1:
        m += 12
        y -= 1
    last = calendar.monthrange(y, m)[1]
    return date(y, m, min(d.day, last))


def effective_deadline(payment: Payment) -> Optional[date]:
    eff = getattr(payment, "effective_planned_deadline", None)
    if eff:
        return eff
    return getattr(payment, "planned_deadline", None)


def _is_recurring_billing(p: Payment) -> bool:
    cat = (getattr(p, "project_category", None) or "").strip()
    if cat in ("tech_support", "hosting_domain"):
        return True
    pt = (p.payment_type or "").strip().lower()
    return pt in ("monthly", "recurring", "service")


def _internal_cost(p: Payment) -> Decimal:
    def _cz(attr: str) -> Decimal:
        v = getattr(p, attr, None)
        return Decimal(str(v)) if v is not None else Decimal("0")

    return (
        _cz("projects_cost_design_uzs")
        + _cz("projects_cost_dev_uzs")
        + _cz("projects_cost_other_uzs")
        + _cz("projects_cost_seo_uzs")
    ).quantize(Decimal("0.01"))


def _sum_paid(p: Payment) -> Decimal:
    months = sorted(p.months or [], key=lambda x: (x.month, x.id))
    total = Decimal("0")
    for pm in months:
        if pm.status == "paid":
            amt = pm.amount if pm.amount is not None else p.amount
            total += Decimal(str(amt or 0))
    if not months and p.status == "paid":
        total = Decimal(str(p.amount or 0))
    return total.quantize(Decimal("0.01"))


def compute_project_profit(p: Payment) -> Decimal:
    """Прибыль проекта (как в Projects Cost): только на бэке, не отдаётся ПМ."""
    internal = _internal_cost(p)
    rec = _is_recurring_billing(p)
    if rec:
        return (_sum_paid(p) - internal).quantize(Decimal("0.01"))
    basis = Decimal(str(p.amount or 0))
    return (basis - internal).quantize(Decimal("0.01"))


def is_final_payment_collected(p: Payment) -> bool:
    months = p.months or []
    if months:
        return all(m.status == "paid" for m in months)
    return p.status == "paid"


def is_pm_closed(p: Payment) -> bool:
    return getattr(p, "pm_closed_at", None) is not None


def pm_commission_status(p: Payment) -> str:
    stored = (getattr(p, "pm_commission_status", None) or "").strip()
    if stored == "paid":
        return "paid"
    if is_pm_closed(p):
        return "locked"
    return "forecast"


def compute_pm_rate_percent(
    *,
    quality_ok: bool,
    actual_close_date: Optional[date],
    planned_deadline: Optional[date],
    effective_planned_deadline: Optional[date],
    nps_score: Optional[int],
    portfolio_case: bool,
    is_closed: bool,
    forecast_mode: bool = False,
) -> Decimal:
    """Ставка ПМ: 0 / 4 / 5 / 6 (%). NPS для 4% — от 6 и выше."""
    if quality_ok is False:
        return Decimal(0)

    deadline = effective_planned_deadline or planned_deadline
    close = actual_close_date
    if close is None and forecast_mode:
        close = date.today()
    if close is None:
        return Decimal(0)

    if deadline is None:
        if forecast_mode and not is_closed:
            return Decimal(5)
        return Decimal(0)

    on_time = close <= deadline
    one_month_later = _add_calendar_months(deadline, 1)
    if close > one_month_later:
        return Decimal(0)

    nps = nps_score
    if forecast_mode and not is_closed and nps is None:
        nps = 6

    if on_time and nps is not None and nps in (9, 10) and portfolio_case:
        return Decimal(6)
    if on_time:
        return Decimal(5)
    if nps is not None and nps >= 6:
        return Decimal(4)
    if forecast_mode and not is_closed and not on_time:
        return Decimal(4)
    return Decimal(0)


def compute_pm_amount(profit: Decimal, rate_percent: Decimal) -> Decimal:
    if profit <= 0 or rate_percent <= 0:
        return Decimal(0)
    return (profit * rate_percent / Decimal(100)).quantize(Decimal("0.01"))


def next_rate_hint(
    current_rate: Decimal,
    *,
    quality_ok: bool,
    on_time: bool,
    nps_score: Optional[int],
    portfolio_case: bool,
    is_closed: bool,
    delay_days: int,
    deadline: Optional[date],
) -> Optional[str]:
    if not quality_ok:
        return "Качество не принято — комиссия 0%"
    if deadline and delay_days > 31:
        return "Просрочка больше месяца — комиссия 0%"
    if current_rate >= Decimal(6):
        return None
    if current_rate >= Decimal(5) and is_closed:
        if nps_score is None or nps_score < 9:
            return "NPS 9–10 + кейс в портфолио → 6%"
        if not portfolio_case:
            return "Кейс в портфолио → 6%"
        return None
    if not on_time and delay_days <= 31:
        if nps_score is None or nps_score < 6:
            return "NPS от 6 → 4%; в срок → 5%"
        return "Сдайте в срок → 5%"
    if on_time:
        if nps_score is None or nps_score < 9:
            return "NPS 9–10 + кейс в портфолио → 6%"
        if not portfolio_case:
            return "Кейс в портфолио → 6%"
        return None
    return "Сдайте в срок → 5%"


def build_pm_commission_state(p: Payment, *, locked_override_rate: Optional[Decimal] = None) -> Dict[str, Any]:
    """Полное состояние комиссии ПМ (для CEO / внутреннего использования)."""
    closed = is_pm_closed(p)
    status = pm_commission_status(p)
    deadline = effective_deadline(p)
    close = getattr(p, "actual_close_date", None)
    quality_ok = getattr(p, "quality_ok", True)
    if quality_ok is None:
        quality_ok = True
    nps = getattr(p, "nps_score", None)
    portfolio = bool(getattr(p, "portfolio_case", False))
    eff_dl = getattr(p, "effective_planned_deadline", None)
    planned = getattr(p, "planned_deadline", None)

    delay_days = 0
    on_time = False
    if deadline and close:
        delay_days = (close - deadline).days
        on_time = close <= deadline
    elif deadline and not closed:
        delay_days = (date.today() - deadline).days
        on_time = date.today() <= deadline

    if closed and getattr(p, "pm_commission_rate", None) is not None:
        rate = Decimal(str(p.pm_commission_rate))
    elif locked_override_rate is not None:
        rate = locked_override_rate
    else:
        rate = compute_pm_rate_percent(
            quality_ok=quality_ok,
            actual_close_date=close,
            planned_deadline=planned,
            effective_planned_deadline=eff_dl,
            nps_score=nps,
            portfolio_case=portfolio,
            is_closed=closed,
            forecast_mode=not closed,
        )

    profit = compute_project_profit(p)
    amount = compute_pm_amount(profit, rate)
    if closed and getattr(p, "pm_commission_amount", None) is not None:
        amount = Decimal(str(p.pm_commission_amount))

    paid = Decimal(str(getattr(p, "pm_commission_paid_uzs", 0) or 0))
    hint = next_rate_hint(
        rate,
        quality_ok=quality_ok,
        on_time=on_time,
        nps_score=nps,
        portfolio_case=portfolio,
        is_closed=closed,
        delay_days=delay_days,
        deadline=deadline,
    )

    pm_id = None
    pm_name = None
    if p.partner and getattr(p.partner, "manager", None):
        pm_id = p.partner.manager_id
        pm_name = p.partner.manager.name

    return {
        "payment_id": p.id,
        "project_name": (p.description or "").strip() or f"Проект #{p.id}",
        "pm_id": pm_id,
        "pm_name": pm_name,
        "planned_deadline": planned,
        "effective_planned_deadline": eff_dl,
        "actual_close_date": close,
        "quality_ok": quality_ok,
        "quality_fail_reason": getattr(p, "quality_fail_reason", None),
        "nps_score": nps,
        "portfolio_case": portfolio,
        "deadline_shift_reason": getattr(p, "deadline_shift_reason", None),
        "rate_percent": rate,
        "amount": amount,
        "profit": profit,
        "status": status,
        "paid_uzs": paid,
        "debt_uzs": max(Decimal(0), amount - paid),
        "hint_next_rate": hint,
        "on_time": on_time,
        "delay_days": delay_days,
        "final_payment_collected": is_final_payment_collected(p),
        "pm_closed_at": getattr(p, "pm_closed_at", None),
    }


def build_pm_projection(p: Payment) -> Dict[str, Any]:
    """Урезанная проекция для ПМ — без прибыли, стоимости и чужих данных."""
    state = build_pm_commission_state(p)
    return {
        "payment_id": state["payment_id"],
        "project_name": state["project_name"],
        "status": state["status"],
        "rate_percent": state["rate_percent"],
        "amount": state["amount"],
        "paid_uzs": state["paid_uzs"],
        "debt_uzs": state["debt_uzs"],
        "hint_next_rate": state["hint_next_rate"],
        "planned_deadline": state["planned_deadline"],
        "actual_close_date": state["actual_close_date"],
    }


def validate_close_requirements(p: Payment) -> List[str]:
    errors: List[str] = []
    if not is_final_payment_collected(p):
        errors.append("Финальный платёж не собран — все строки графика должны быть оплачены.")
    if getattr(p, "nps_score", None) is None:
        errors.append("Укажите NPS клиента (0–10).")
    else:
        nps = int(p.nps_score)
        if nps < 0 or nps > 10:
            errors.append("NPS должен быть от 0 до 10.")
    if getattr(p, "quality_ok", True) is False:
        reason = (getattr(p, "quality_fail_reason", None) or "").strip()
        if not reason:
            errors.append("Укажите причину, если качество не принято.")
    if getattr(p, "portfolio_case", None) is None:
        errors.append("Укажите, взят ли проект в портфолио (portfolio_case).")
    if not getattr(p, "actual_close_date", None):
        errors.append("Укажите фактическую дату закрытия.")
    return errors


def lock_pm_commission(
    db: Session,
    p: Payment,
    *,
    actor_user_id: int,
    override_rate: Optional[Decimal] = None,
    override_reason: Optional[str] = None,
) -> Dict[str, Any]:
    from app.models.pm_commission_log import PmCommissionLog

    errors = validate_close_requirements(p)
    if errors:
        raise ValueError("; ".join(errors))

    state = build_pm_commission_state(p)
    rate = override_rate if override_rate is not None else state["rate_percent"]
    profit = state["profit"]
    amount = compute_pm_amount(profit, rate)

    p.pm_commission_rate = rate
    p.pm_commission_amount = amount
    p.pm_commission_status = "locked"
    p.pm_closed_at = datetime.utcnow()

    log = PmCommissionLog(
        company_slug=p.company_slug,
        payment_id=p.id,
        pm_id=state["pm_id"],
        action="lock" if override_rate is None else "override",
        rate_percent=rate,
        amount=amount,
        profit=profit,
        inputs_json=json.dumps(
            {
                "on_time": state["on_time"],
                "delay_days": state["delay_days"],
                "nps_score": state["nps_score"],
                "quality_ok": state["quality_ok"],
                "portfolio_case": state["portfolio_case"],
                "planned_deadline": str(state["planned_deadline"]) if state["planned_deadline"] else None,
                "actual_close_date": str(state["actual_close_date"]) if state["actual_close_date"] else None,
            },
            ensure_ascii=False,
        ),
        actor_user_id=actor_user_id,
        override_reason=override_reason,
    )
    db.add(log)
    db.flush()
    return build_pm_commission_state(p)
