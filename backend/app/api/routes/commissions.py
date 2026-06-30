import calendar
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import extract, or_
from typing import List, Optional
from decimal import Decimal

from app.db.database import get_db, get_request_company
from app.models.commission import Commission
from app.models.payment import Payment
from app.models.partner import Partner
from app.models.user import User
from app.schemas.schemas import (
    CommissionCreate,
    CommissionUpdate,
    CommissionOut,
    CommissionStatsOut,
    CommissionLinkablePaymentOut,
    PmCommissionSnippetOut,
)
from app.core.security import get_current_user
from app.services.pm_commission import build_pm_commission_state

router = APIRouter(prefix="/api/commissions", tags=["commissions"])


def _require_commissions_role(user: User) -> None:
    if user.role in ("administration", "employee"):
        raise HTTPException(
            status_code=403,
            detail="Раздел комиссий менеджеров недоступен для роли «Администрация».",
        )


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


def _validate_payment_for_commission(db: Session, payment_id: int) -> None:
    """Проект существует и доступен для привязки (менеджер комиссии может отличаться от ПМ в карточке)."""
    p = (
        db.query(Payment)
        .options(joinedload(Payment.partner))
        .filter(
            Payment.id == payment_id,
            Payment.is_archived == False,
            Payment.trashed_at.is_(None),
            Payment.company_slug == get_request_company(),
        )
        .first()
    )
    if not p:
        raise HTTPException(status_code=400, detail="Проект не найден или в архиве")
    if p.partner and p.partner.trashed_at is not None:
        raise HTTPException(status_code=400, detail="Партнёр проекта в корзине")
    if getattr(p, "project_category", None) == "hosting_domain":
        raise HTTPException(
            status_code=400,
            detail="Проекты категории «Хостинг/домен» не участвуют в комиссиях менеджера.",
        )


def _enrich(c: Commission, db: Optional[Session] = None) -> CommissionOut:
    out = CommissionOut.model_validate(c)
    cost = Decimal(str(c.project_cost or 0))
    prod = Decimal(str(c.production_cost or 0))
    pct = Decimal(str(c.manager_percent or 0))
    actual = Decimal(str(c.actual_payment or 0))
    r1 = Decimal(str(c.received_amount_1 or 0))
    r2 = Decimal(str(c.received_amount_2 or 0))

    profit = cost - prod
    out.profit = profit
    out.total_manager_income = (profit * pct / 100).quantize(Decimal("0.01"))
    out.manager_income_from_actual = (actual * pct / 100).quantize(Decimal("0.01"))
    out.total_received = r1 + r2
    pay = getattr(c, "payment", None)
    if pay is not None:
        out.linked_payment_description = (pay.description or "").strip() or None
        out.linked_partner_name = (pay.partner.name if pay.partner else None) or None
        if db is not None and pay.partner:
            pm_state = build_pm_commission_state(pay)
            out.pm = PmCommissionSnippetOut(
                pm_id=pm_state.get("pm_id"),
                pm_name=pm_state.get("pm_name"),
                rate_percent=pm_state["rate_percent"],
                amount=pm_state["amount"],
                status=pm_state["status"],
                hint_next_rate=pm_state.get("hint_next_rate"),
            )
    else:
        out.linked_payment_description = None
        out.linked_partner_name = None
    return out


def _commission_load_options(q):
    return q.options(
        joinedload(Commission.manager),
        joinedload(Commission.payment).joinedload(Payment.partner).joinedload(Partner.manager),
        joinedload(Commission.payment).joinedload(Payment.months),
    )


def _commission_owned_by(user: User, c: Commission) -> bool:
    if user.role in ("admin", "accountant", "financier"):
        return True
    if user.role in ("manager", "mop") and c.manager_id == user.id:
        return True
    return False


def _base_query(db: Session, current_user: User, year: Optional[int], month: Optional[int], manager_id: Optional[int]):
    q = db.query(Commission).filter(Commission.company_slug == get_request_company())
    q = _commission_load_options(q)
    if current_user.role in ("manager", "mop"):
        q = q.filter(Commission.manager_id == current_user.id)
    elif manager_id:
        q = q.filter(Commission.manager_id == manager_id)
    if year:
        q = q.filter(extract("year", Commission.project_date) == year)
    if month:
        q = q.filter(extract("month", Commission.project_date) == month)
    return q


@router.get("/linkable-payments", response_model=List[CommissionLinkablePaymentOut])
def linkable_payments(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    for_commission: bool = Query(
        False,
        description="Если true — только проекты, по которым начисляется комиссия (исключаются хостинг/домен).",
    ),
):
    """Активные проекты «Проекты» для привязки. Для раздела «Комиссия» передавайте for_commission=true."""
    if current_user.role in ("administration", "employee"):
        raise HTTPException(status_code=403, detail="Нет доступа")

    q = (
        db.query(Payment)
        .options(joinedload(Payment.partner).joinedload(Partner.manager))
        .join(Partner, Partner.id == Payment.partner_id)
        .filter(
            Payment.is_archived == False,
            Payment.trashed_at.is_(None),
            Payment.company_slug == get_request_company(),
            Partner.trashed_at.is_(None),
            Partner.company_slug == get_request_company(),
        )
    )
    if for_commission:
        q = q.filter(
            or_(
                Payment.project_category.is_(None),
                Payment.project_category != "hosting_domain",
            )
        )
    rows = q.order_by(Payment.id.desc()).limit(1000).all()
    return [
        CommissionLinkablePaymentOut(
            id=p.id,
            description=(p.description or "").strip() or f"Проект #{p.id}",
            partner_name=((p.partner.name if p.partner else None) or "").strip() or "—",
            partner_manager_name=(
                (p.partner.manager.name if p.partner and getattr(p.partner, "manager", None) else None) or None
            ),
        )
        for p in rows
    ]


@router.get("/stats", response_model=CommissionStatsOut)
def get_stats(
    year: Optional[int] = None,
    month: Optional[int] = None,
    manager_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_commissions_role(current_user)
    rows = _base_query(db, current_user, year, month, manager_id).all()
    total_cost = total_profit = total_mgr = total_recv = total_pm_plan = total_pm_debt = Decimal(0)
    payment_ids: set[int] = set()
    for c in rows:
        cost = Decimal(str(c.project_cost or 0))
        prod = Decimal(str(c.production_cost or 0))
        pct = Decimal(str(c.manager_percent or 0))
        profit = cost - prod
        total_cost += cost
        total_profit += profit
        total_mgr += profit * pct / 100
        total_recv += Decimal(str(c.received_amount_1 or 0)) + Decimal(str(c.received_amount_2 or 0))
        pay = getattr(c, "payment", None)
        if pay is not None and pay.id not in payment_ids:
            payment_ids.add(pay.id)
            pm_st = build_pm_commission_state(pay)
            total_pm_plan += Decimal(str(pm_st["amount"]))
            total_pm_debt += Decimal(str(pm_st["debt_uzs"]))
    pending = total_mgr - total_recv
    return CommissionStatsOut(
        total_projects=len(rows),
        total_cost=total_cost,
        total_profit=total_profit,
        total_manager_income=total_mgr.quantize(Decimal("0.01")),
        total_received=total_recv,
        total_pending=max(Decimal(0), pending).quantize(Decimal("0.01")),
        total_pm_income_plan=total_pm_plan.quantize(Decimal("0.01")),
        total_pm_debt=total_pm_debt.quantize(Decimal("0.01")),
    )


@router.get("", response_model=List[CommissionOut])
def list_commissions(
    year: Optional[int] = None,
    month: Optional[int] = None,
    manager_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_commissions_role(current_user)
    rows = (
        _base_query(db, current_user, year, month, manager_id)
        .order_by(Commission.project_date.desc(), Commission.id.desc())
        .all()
    )
    return [_enrich(c, db) for c in rows]


@router.post("", response_model=CommissionOut)
def create_commission(
    data: CommissionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_commissions_role(current_user)
    mgr_id = current_user.id
    if current_user.role in ("admin", "accountant") and data.manager_id:
        mgr_id = data.manager_id
    elif current_user.role == "mop":
        mgr_id = current_user.id

    dup_n = max(0, min(36, int(data.duplicate_months or 0)))
    pid = data.payment_id
    if pid is not None:
        _validate_payment_for_commission(db, int(pid))

    first_id: Optional[int] = None
    for k in range(dup_n + 1):
        pd = _add_calendar_months(data.project_date, k)
        c = Commission(
            company_slug=get_request_company(),
            project_name=data.project_name,
            project_type=data.project_type,
            project_cost=data.project_cost,
            production_cost=data.production_cost,
            manager_percent=data.manager_percent,
            actual_payment=data.actual_payment,
            received_amount_1=data.received_amount_1 if k == 0 else None,
            received_amount_2=data.received_amount_2 if k == 0 else None,
            received_amount_1_on=data.received_amount_1_on if k == 0 else None,
            received_amount_2_on=data.received_amount_2_on if k == 0 else None,
            commission_paid_full=data.commission_paid_full if k == 0 else False,
            project_date=pd,
            note=data.note,
            manager_id=mgr_id,
            payment_id=int(pid) if (k == 0 and pid is not None) else None,
        )
        db.add(c)
        db.flush()
        if k == 0:
            first_id = c.id
    db.commit()
    row = (
        _commission_load_options(db.query(Commission))
        .filter(Commission.id == first_id, Commission.company_slug == get_request_company())
        .first()
    )
    return _enrich(row, db)


@router.put("/{cid}", response_model=CommissionOut)
def update_commission(
    cid: int,
    data: CommissionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_commissions_role(current_user)
    c = (
        db.query(Commission)
        .filter(Commission.id == cid, Commission.company_slug == get_request_company())
        .first()
    )
    if not c:
        raise HTTPException(404, "Не найдено")
    if not _commission_owned_by(current_user, c):
        raise HTTPException(403, "Нет доступа")
    patch = data.model_dump(exclude_unset=True)
    if current_user.role == "mop":
        allowed = {
            "manager_percent",
            "received_amount_1",
            "received_amount_2",
            "received_amount_1_on",
            "received_amount_2_on",
            "note",
        }
        patch = {k: v for k, v in patch.items() if k in allowed}
        if not patch:
            raise HTTPException(status_code=400, detail="Нет допустимых полей для изменения")
        if "manager_percent" in patch and patch["manager_percent"] is not None:
            pct = Decimal(str(patch["manager_percent"]))
            if pct < 1 or pct > 20:
                raise HTTPException(status_code=400, detail="% комиссии: от 1 до 20")
    for field, val in patch.items():
        setattr(c, field, val)
    if c.payment_id is not None:
        _validate_payment_for_commission(db, int(c.payment_id))
    db.commit()
    row = (
        _commission_load_options(db.query(Commission))
        .filter(Commission.id == cid, Commission.company_slug == get_request_company())
        .first()
    )
    return _enrich(row, db)


@router.post("/{cid}/duplicate-next-month", response_model=CommissionOut)
def duplicate_commission_next_month(
    cid: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Копия строки комиссии на следующий календарный месяц (рекуррент). Полученные суммы сбрасываются."""
    _require_commissions_role(current_user)
    src = (
        db.query(Commission)
        .filter(Commission.id == cid, Commission.company_slug == get_request_company())
        .first()
    )
    if not src:
        raise HTTPException(404, "Не найдено")
    if not _commission_owned_by(current_user, src):
        raise HTTPException(403, "Нет доступа")
    new = Commission(
        company_slug=get_request_company(),
        project_name=src.project_name,
        project_type=src.project_type,
        project_cost=src.project_cost,
        production_cost=src.production_cost,
        manager_percent=src.manager_percent,
        actual_payment=src.actual_payment,
        received_amount_1=None,
        received_amount_2=None,
        received_amount_1_on=None,
        received_amount_2_on=None,
        commission_paid_full=False,
        project_date=_add_calendar_months(src.project_date, 1),
        note=src.note,
        manager_id=src.manager_id,
        payment_id=src.payment_id,
    )
    db.add(new)
    db.commit()
    row = (
        _commission_load_options(db.query(Commission))
        .filter(Commission.id == new.id, Commission.company_slug == get_request_company())
        .first()
    )
    return _enrich(row, db)


@router.post("/{cid}/shift-next-month", response_model=CommissionOut)
def shift_commission_next_month(
    cid: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Сдвиг даты проекта на +1 месяц (та же строка)."""
    _require_commissions_role(current_user)
    c = (
        db.query(Commission)
        .filter(Commission.id == cid, Commission.company_slug == get_request_company())
        .first()
    )
    if not c:
        raise HTTPException(404, "Не найдено")
    if not _commission_owned_by(current_user, c):
        raise HTTPException(403, "Нет доступа")
    c.project_date = _add_calendar_months(c.project_date, 1)
    db.commit()
    row = (
        _commission_load_options(db.query(Commission))
        .filter(Commission.id == cid, Commission.company_slug == get_request_company())
        .first()
    )
    return _enrich(row, db)


@router.delete("/{cid}")
def delete_commission(
    cid: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_commissions_role(current_user)
    c = (
        db.query(Commission)
        .filter(Commission.id == cid, Commission.company_slug == get_request_company())
        .first()
    )
    if not c:
        raise HTTPException(404, "Не найдено")
    if not _commission_owned_by(current_user, c):
        raise HTTPException(403, "Нет доступа")
    db.delete(c)
    db.commit()
    return {"ok": True}
