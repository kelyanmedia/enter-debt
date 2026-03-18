from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from datetime import date, datetime
from app.db.database import get_db
from app.models.payment import Payment
from app.models.partner import Partner
from app.schemas.schemas import PaymentOut, PaymentCreate, PaymentUpdate, PaymentConfirm
from app.core.security import get_current_user, require_manager_or_admin

router = APIRouter(prefix="/api/payments", tags=["payments"])


def compute_days_until_due(p: Payment) -> Optional[int]:
    today = date.today()
    if p.status in ("paid", "archived"):
        return None
    if p.deadline_date:
        return (p.deadline_date - today).days
    if p.day_of_month:
        d = today.replace(day=p.day_of_month) if p.day_of_month >= today.day else \
            (today.replace(month=today.month % 12 + 1, day=p.day_of_month) if today.month < 12
             else today.replace(year=today.year + 1, month=1, day=p.day_of_month))
        return (d - today).days
    return None


def enrich(p: Payment) -> PaymentOut:
    out = PaymentOut.model_validate(p)
    out.days_until_due = compute_days_until_due(p)
    return out


@router.get("", response_model=List[PaymentOut])
def list_payments(
    status: Optional[str] = None,
    partner_id: Optional[int] = None,
    payment_type: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user)
):
    q = db.query(Payment).options(
        joinedload(Payment.partner).joinedload(Partner.manager),
        joinedload(Payment.confirmed_by_user)
    ).filter(Payment.is_archived == False)
    if status:
        q = q.filter(Payment.status == status)
    if partner_id:
        q = q.filter(Payment.partner_id == partner_id)
    if payment_type:
        q = q.filter(Payment.payment_type == payment_type)
    payments = q.order_by(Payment.created_at.desc()).all()
    return [enrich(p) for p in payments]


@router.get("/{payment_id}", response_model=PaymentOut)
def get_payment(payment_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    p = db.query(Payment).options(
        joinedload(Payment.partner),
        joinedload(Payment.confirmed_by_user)
    ).filter(Payment.id == payment_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    return enrich(p)


@router.post("", response_model=PaymentOut)
def create_payment(data: PaymentCreate, db: Session = Depends(get_db), _=Depends(require_manager_or_admin)):
    payment = Payment(**data.model_dump())
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return enrich(payment)


@router.put("/{payment_id}", response_model=PaymentOut)
def update_payment(payment_id: int, data: PaymentUpdate, db: Session = Depends(get_db), _=Depends(require_manager_or_admin)):
    p = db.query(Payment).filter(Payment.id == payment_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(p, field, value)
    db.commit()
    db.refresh(p)
    return enrich(p)


@router.post("/{payment_id}/confirm", response_model=PaymentOut)
def confirm_payment(payment_id: int, data: PaymentConfirm, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    p = db.query(Payment).filter(Payment.id == payment_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    p.status = "paid"
    p.paid_at = datetime.utcnow()
    p.confirmed_by = current_user.id
    db.commit()
    db.refresh(p)
    return enrich(p)


@router.delete("/{payment_id}")
def delete_payment(payment_id: int, db: Session = Depends(get_db), _=Depends(require_manager_or_admin)):
    p = db.query(Payment).filter(Payment.id == payment_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    p.is_archived = True
    db.commit()
    return {"ok": True}
