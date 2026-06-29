"""API комиссии проектного менеджера (ПМ)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.core.security import get_current_user
from app.db.database import get_db, get_request_company
from app.models.partner import Partner
from app.models.payment import Payment
from app.models.user import User
from app.schemas.schemas import (
    PmCommissionAdminOut,
    PmCommissionCloseIn,
    PmCommissionFieldsPut,
    PmCommissionMarkPaidIn,
    PmCommissionMyOut,
    PmCommissionMyStatsOut,
    PmCommissionOverrideIn,
    PmCommissionStatsOut,
)
from app.services.pm_commission import (
    build_pm_commission_state,
    build_pm_projection,
    is_pm_closed,
    lock_pm_commission,
)

router = APIRouter(prefix="/api/pm-commissions", tags=["pm-commissions"])


def _require_ceo_view(user: User) -> None:
    if user.role not in ("admin", "accountant", "financier"):
        raise HTTPException(status_code=403, detail="Доступ только для CEO/админа/бухгалтерии.")


def _load_payment(db: Session, payment_id: int) -> Payment:
    p = (
        db.query(Payment)
        .options(
            joinedload(Payment.partner).joinedload(Partner.manager),
            joinedload(Payment.months),
        )
        .filter(
            Payment.id == payment_id,
            Payment.company_slug == get_request_company(),
            Payment.is_archived == False,
            Payment.trashed_at.is_(None),
        )
        .first()
    )
    if not p:
        raise HTTPException(status_code=404, detail="Проект не найден")
    return p


def _pm_payments_query(db: Session, current_user: User):
    q = (
        db.query(Payment)
        .options(
            joinedload(Payment.partner).joinedload(Partner.manager),
            joinedload(Payment.months),
        )
        .join(Partner, Partner.id == Payment.partner_id)
        .filter(
            Payment.company_slug == get_request_company(),
            Payment.is_archived == False,
            Payment.trashed_at.is_(None),
            Partner.trashed_at.is_(None),
        )
    )
    if current_user.role == "manager":
        q = q.filter(Partner.manager_id == current_user.id)
    return q


@router.get("/my", response_model=List[PmCommissionMyOut])
def list_my_pm_commissions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Урезанная проекция для ПМ — только свои проекты, без прибыли."""
    if current_user.role not in ("manager", "admin"):
        raise HTTPException(status_code=403, detail="Раздел «Моя комиссия» доступен проектным менеджерам.")
    rows = (
        _pm_payments_query(db, current_user)
        .order_by(Payment.id.desc())
        .limit(500)
        .all()
    )
    return [build_pm_projection(p) for p in rows]


@router.get("/my/stats", response_model=PmCommissionMyStatsOut)
def my_pm_commission_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ("manager", "admin"):
        raise HTTPException(status_code=403, detail="Раздел «Моя комиссия» доступен проектным менеджерам.")
    rows = _pm_payments_query(db, current_user).all()
    locked_total = forecast_total = paid_total = debt_total = Decimal(0)
    for p in rows:
        proj = build_pm_projection(p)
        amt = Decimal(str(proj["amount"]))
        paid = Decimal(str(proj["paid_uzs"]))
        debt = Decimal(str(proj["debt_uzs"]))
        st = proj["status"]
        if st == "paid":
            paid_total += paid
        elif st == "locked":
            locked_total += amt
            debt_total += debt
        else:
            forecast_total += amt
    return PmCommissionMyStatsOut(
        locked_total=locked_total,
        forecast_total=forecast_total,
        paid_total=paid_total,
        debt_total=debt_total,
    )


@router.get("/admin", response_model=List[PmCommissionAdminOut])
def list_admin_pm_commissions(
    pm_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_ceo_view(current_user)
    q = (
        db.query(Payment)
        .options(
            joinedload(Payment.partner).joinedload(Partner.manager),
            joinedload(Payment.months),
        )
        .join(Partner, Partner.id == Payment.partner_id)
        .filter(
            Payment.company_slug == get_request_company(),
            Payment.is_archived == False,
            Payment.trashed_at.is_(None),
            Partner.trashed_at.is_(None),
            Partner.manager_id.isnot(None),
        )
    )
    if pm_id:
        q = q.filter(Partner.manager_id == pm_id)
    rows = q.order_by(Payment.id.desc()).limit(1000).all()
    return [build_pm_commission_state(p) for p in rows]


@router.get("/stats", response_model=PmCommissionStatsOut)
def pm_commission_stats(
    pm_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_ceo_view(current_user)
    q = (
        db.query(Payment)
        .options(joinedload(Payment.partner), joinedload(Payment.months))
        .join(Partner, Partner.id == Payment.partner_id)
        .filter(
            Payment.company_slug == get_request_company(),
            Payment.is_archived == False,
            Payment.trashed_at.is_(None),
            Partner.manager_id.isnot(None),
        )
    )
    if pm_id:
        q = q.filter(Partner.manager_id == pm_id)
    rows = q.all()
    plan = paid = debt = Decimal(0)
    for p in rows:
        st = build_pm_commission_state(p)
        amt = Decimal(str(st["amount"]))
        pu = Decimal(str(st["paid_uzs"]))
        plan += amt
        paid += pu
        debt += Decimal(str(st["debt_uzs"]))
    return PmCommissionStatsOut(
        total_pm_income_plan=plan,
        total_pm_paid=paid,
        total_pm_debt=debt,
    )


@router.put("/{payment_id}/fields", response_model=PmCommissionAdminOut)
def update_pm_fields(
    payment_id: int,
    data: PmCommissionFieldsPut,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_ceo_view(current_user)
    p = _load_payment(db, payment_id)
    if is_pm_closed(p) and data.planned_deadline is not None:
        raise HTTPException(status_code=400, detail="Плановый дедлайн нельзя менять после закрытия.")

    patch = data.model_dump(exclude_unset=True)
    for field, val in patch.items():
        setattr(p, field, val)

    if p.quality_ok is False and not (p.quality_fail_reason or "").strip():
        raise HTTPException(status_code=400, detail="Укажите причину, если quality_ok = false.")

    if not is_pm_closed(p):
        p.pm_commission_status = "forecast"

    db.commit()
    db.refresh(p)
    return build_pm_commission_state(p)


@router.post("/{payment_id}/close", response_model=PmCommissionAdminOut)
def close_pm_commission(
    payment_id: int,
    data: PmCommissionCloseIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_ceo_view(current_user)
    p = _load_payment(db, payment_id)
    if is_pm_closed(p):
        raise HTTPException(status_code=400, detail="Проект уже закрыт для комиссии ПМ.")

    p.actual_close_date = data.actual_close_date
    p.nps_score = data.nps_score
    p.quality_ok = data.quality_ok
    p.quality_fail_reason = data.quality_fail_reason
    p.portfolio_case = data.portfolio_case

    try:
        state = lock_pm_commission(db, p, actor_user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    db.commit()
    db.refresh(p)
    return state


@router.post("/{payment_id}/override", response_model=PmCommissionAdminOut)
def override_pm_rate(
    payment_id: int,
    data: PmCommissionOverrideIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_ceo_view(current_user)
    if current_user.role not in ("admin", "financier"):
        raise HTTPException(status_code=403, detail="Override ставки — только admin/financier.")
    p = _load_payment(db, payment_id)
    if not is_pm_closed(p):
        raise HTTPException(status_code=400, detail="Override доступен только после закрытия (locked).")
    if not (data.reason or "").strip():
        raise HTTPException(status_code=400, detail="Укажите причину override.")

    rate = Decimal(str(data.rate_percent))
    try:
        state = lock_pm_commission(
            db,
            p,
            actor_user_id=current_user.id,
            override_rate=rate,
            override_reason=data.reason.strip(),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    db.commit()
    db.refresh(p)
    return state


@router.post("/{payment_id}/mark-paid", response_model=PmCommissionAdminOut)
def mark_pm_paid(
    payment_id: int,
    data: PmCommissionMarkPaidIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_ceo_view(current_user)
    p = _load_payment(db, payment_id)
    if not is_pm_closed(p):
        raise HTTPException(status_code=400, detail="Выплата возможна только после закрытия проекта.")

    amount = Decimal(str(data.amount_uzs))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Сумма должна быть больше 0.")

    p.pm_commission_paid_uzs = (Decimal(str(p.pm_commission_paid_uzs or 0)) + amount).quantize(Decimal("0.01"))
    locked_amt = Decimal(str(p.pm_commission_amount or 0))
    if p.pm_commission_paid_uzs >= locked_amt and locked_amt > 0:
        p.pm_commission_status = "paid"

    db.commit()
    db.refresh(p)
    return build_pm_commission_state(p)
