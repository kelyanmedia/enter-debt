from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import extract
from typing import List, Optional
from decimal import Decimal
from datetime import date

from app.db.database import get_db
from app.models.commission import Commission
from app.models.user import User
from app.schemas.schemas import (
    CommissionCreate, CommissionUpdate, CommissionOut, CommissionStatsOut
)
from app.core.security import get_current_user

router = APIRouter(prefix="/api/commissions", tags=["commissions"])


def _reject_administration(current_user: User) -> None:
    if current_user.role == "administration":
        raise HTTPException(status_code=403, detail="Нет доступа к разделу комиссий")


def _enrich(c: Commission) -> CommissionOut:
    out = CommissionOut.model_validate(c)
    cost = Decimal(str(c.project_cost or 0))
    prod = Decimal(str(c.production_cost or 0))
    pct  = Decimal(str(c.manager_percent or 0))
    actual = Decimal(str(c.actual_payment or 0))
    r1 = Decimal(str(c.received_amount_1 or 0))
    r2 = Decimal(str(c.received_amount_2 or 0))

    profit = cost - prod
    out.profit = profit
    out.total_manager_income     = (profit * pct / 100).quantize(Decimal("0.01"))
    out.manager_income_from_actual = (actual * pct / 100).quantize(Decimal("0.01"))
    out.total_received = r1 + r2
    return out


def _base_query(db: Session, current_user: User,
                year: Optional[int], month: Optional[int],
                manager_id: Optional[int]):
    q = db.query(Commission).options(joinedload(Commission.manager))
    if current_user.role == "manager":
        q = q.filter(Commission.manager_id == current_user.id)
    elif manager_id:
        q = q.filter(Commission.manager_id == manager_id)
    if year:
        q = q.filter(extract("year",  Commission.project_date) == year)
    if month:
        q = q.filter(extract("month", Commission.project_date) == month)
    return q


@router.get("/stats", response_model=CommissionStatsOut)
def get_stats(
    year: Optional[int] = None,
    month: Optional[int] = None,
    manager_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _reject_administration(current_user)
    rows = _base_query(db, current_user, year, month, manager_id).all()
    total_cost = total_profit = total_mgr = total_recv = Decimal(0)
    for c in rows:
        cost   = Decimal(str(c.project_cost or 0))
        prod   = Decimal(str(c.production_cost or 0))
        pct    = Decimal(str(c.manager_percent or 0))
        profit = cost - prod
        total_cost   += cost
        total_profit += profit
        total_mgr    += (profit * pct / 100)
        total_recv   += Decimal(str(c.received_amount_1 or 0)) + Decimal(str(c.received_amount_2 or 0))
    pending = total_mgr - total_recv
    return CommissionStatsOut(
        total_projects=len(rows),
        total_cost=total_cost,
        total_profit=total_profit,
        total_manager_income=total_mgr.quantize(Decimal("0.01")),
        total_received=total_recv,
        total_pending=max(Decimal(0), pending).quantize(Decimal("0.01")),
    )


@router.get("", response_model=List[CommissionOut])
def list_commissions(
    year: Optional[int] = None,
    month: Optional[int] = None,
    manager_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _reject_administration(current_user)
    rows = _base_query(db, current_user, year, month, manager_id)\
        .order_by(Commission.project_date.desc(), Commission.id.desc()).all()
    return [_enrich(c) for c in rows]


@router.post("", response_model=CommissionOut)
def create_commission(
    data: CommissionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _reject_administration(current_user)
    mgr_id = current_user.id
    if current_user.role in ("admin", "accountant") and data.manager_id:
        mgr_id = data.manager_id

    c = Commission(
        project_name=data.project_name,
        project_type=data.project_type,
        project_cost=data.project_cost,
        production_cost=data.production_cost,
        manager_percent=data.manager_percent,
        actual_payment=data.actual_payment,
        received_amount_1=data.received_amount_1,
        received_amount_2=data.received_amount_2,
        commission_paid_full=data.commission_paid_full,
        project_date=data.project_date,
        note=data.note,
        manager_id=mgr_id,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    c = db.query(Commission).options(joinedload(Commission.manager)).filter(Commission.id == c.id).first()
    return _enrich(c)


@router.put("/{cid}", response_model=CommissionOut)
def update_commission(
    cid: int,
    data: CommissionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _reject_administration(current_user)
    c = db.query(Commission).filter(Commission.id == cid).first()
    if not c:
        raise HTTPException(404, "Не найдено")
    if current_user.role == "manager" and c.manager_id != current_user.id:
        raise HTTPException(403, "Нет доступа")
    for field, val in data.model_dump(exclude_none=True).items():
        setattr(c, field, val)
    db.commit()
    c = db.query(Commission).options(joinedload(Commission.manager)).filter(Commission.id == cid).first()
    return _enrich(c)


@router.delete("/{cid}")
def delete_commission(
    cid: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _reject_administration(current_user)
    c = db.query(Commission).filter(Commission.id == cid).first()
    if not c:
        raise HTTPException(404, "Не найдено")
    if current_user.role == "manager" and c.manager_id != current_user.id:
        raise HTTPException(403, "Нет доступа")
    db.delete(c)
    db.commit()
    return {"ok": True}
