from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from datetime import date, datetime
from calendar import monthrange
from app.db.database import get_db
from app.models.payment import Payment, PaymentMonth
from app.models.partner import Partner
from app.schemas.schemas import PaymentOut, PaymentCreate, PaymentUpdate, PaymentConfirm
from app.core.security import get_current_user, require_payment_write
from app.core.access import assert_partner_access, filter_payments_query
from app.models.user import User

router = APIRouter(prefix="/api/payments", tags=["payments"])


def compute_days_until_due(p: Payment) -> Optional[int]:
    today = date.today()
    if p.status in ("paid", "archived"):
        return None
    if p.deadline_date:
        return (p.deadline_date - today).days
    if p.day_of_month:
        try:
            dom = int(p.day_of_month)
            if dom < 1 or dom > 31:
                return None
            d = today.replace(day=dom) if dom >= today.day else (
                today.replace(month=today.month % 12 + 1, day=dom)
                if today.month < 12
                else today.replace(year=today.year + 1, month=1, day=dom)
            )
            return (d - today).days
        except (ValueError, OverflowError):
            return None
    return None


def load_payment(db: Session, payment_id: int) -> Payment:
    return db.query(Payment).options(
        joinedload(Payment.partner).joinedload(Partner.manager),
        joinedload(Payment.confirmed_by_user),
        joinedload(Payment.months),
    ).filter(Payment.id == payment_id).first()


def enrich(p: Payment) -> PaymentOut:
    out = PaymentOut.model_validate(p)
    out.days_until_due = compute_days_until_due(p)
    out.source_payment_month_id = None
    return out


def _due_date_for_payment_month(pm: PaymentMonth, p: Payment) -> date:
    if pm.due_date:
        return pm.due_date
    y, m = pm.month.split("-")
    yi, mi = int(y), int(m)
    last_d = monthrange(yi, mi)[1]
    if p.day_of_month:
        return date(yi, mi, min(int(p.day_of_month), last_d))
    return date(yi, mi, last_d)


def enrich_as_month_line(p: Payment, pm: PaymentMonth, today: date) -> PaymentOut:
    """Одна неоплаченная строка месяца как отдельная позиция для дебиторки."""
    out = PaymentOut.model_validate(p)
    due = _due_date_for_payment_month(pm, p)
    out.deadline_date = due
    out.day_of_month = due.day
    eff = pm.amount if pm.amount is not None else p.amount
    out.amount = eff
    desc = (pm.description or "").strip()
    out.description = desc if desc else p.description
    out.status = "overdue" if due < today else "pending"
    out.days_until_due = (due - today).days
    out.source_payment_month_id = pm.id
    out.months = []
    out.postponed_until = None
    out.paid_at = None
    return out


@router.get("", response_model=List[PaymentOut])
def list_payments(
    status: Optional[str] = None,
    partner_id: Optional[int] = None,
    payment_type: Optional[str] = None,
    project_category: Optional[str] = None,
    expand_month_lines: bool = Query(
        False,
        description="Развернуть неоплаченные строки payment_months в отдельные позиции (срок — due_date строки)",
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Payment).options(
        joinedload(Payment.partner).joinedload(Partner.manager),
        joinedload(Payment.confirmed_by_user),
        joinedload(Payment.months),
    ).filter(Payment.is_archived == False)
    q = filter_payments_query(q, db, current_user)
    if partner_id:
        q = q.filter(Payment.partner_id == partner_id)
    if payment_type:
        q = q.filter(Payment.payment_type == payment_type)
    if project_category:
        q = q.filter(Payment.project_category == project_category)

    use_expand = expand_month_lines and status in ("pending", "overdue")
    if status and not use_expand:
        q = q.filter(Payment.status == status)

    payments = q.order_by(Payment.created_at.desc()).all()
    today = date.today()

    if not use_expand:
        return [enrich(p) for p in payments]

    out: List[PaymentOut] = []
    for p in payments:
        unpaid = [m for m in (p.months or []) if m.status != "paid"]
        if unpaid:
            for pm in sorted(unpaid, key=lambda x: x.month):
                line = enrich_as_month_line(p, pm, today)
                if line.status != status:
                    continue
                out.append(line)
        else:
            if p.status == status:
                out.append(enrich(p))
    return out


@router.get("/{payment_id}", response_model=PaymentOut)
def get_payment(payment_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    p = db.query(Payment).options(
        joinedload(Payment.partner),
        joinedload(Payment.confirmed_by_user)
    ).filter(Payment.id == payment_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    assert_partner_access(db, current_user, p.partner_id)
    return enrich(p)


@router.post("", response_model=PaymentOut)
def create_payment(
    data: PaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_payment_write),
):
    assert_partner_access(db, current_user, data.partner_id)
    payment = Payment(**data.model_dump())
    db.add(payment)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Не удалось сохранить проект (конфликт данных). Обновите страницу и выберите партнёра из списка.",
        )
    p = load_payment(db, payment.id)
    if not p:
        raise HTTPException(status_code=500, detail="Проект создан, но не удалось загрузить ответ. Обновите страницу.")
    # emit в отдельной сессии — не трогает текущую db
    from app.services.feed_events import emit_payment_created
    emit_payment_created(payment.id, payment.partner_id, data.description)
    return enrich(p)


@router.put("/{payment_id}", response_model=PaymentOut)
def update_payment(
    payment_id: int,
    data: PaymentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_payment_write),
):
    p = db.query(Payment).filter(Payment.id == payment_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    assert_partner_access(db, current_user, p.partner_id)
    upd = data.model_dump(exclude_none=True)
    if "partner_id" in upd:
        assert_partner_access(db, current_user, upd["partner_id"])
    for field, value in upd.items():
        setattr(p, field, value)
    db.commit()
    p = load_payment(db, payment_id)
    return enrich(p)


@router.post("/{payment_id}/confirm", response_model=PaymentOut)
def confirm_payment(
    payment_id: int,
    data: PaymentConfirm,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    p = db.query(Payment).filter(Payment.id == payment_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    assert_partner_access(db, current_user, p.partner_id)
    if data.postpone_days and data.postpone_days > 0:
        from datetime import timedelta
        p.postponed_until = date.today() + timedelta(days=data.postpone_days)
        p.status = "postponed"
    else:
        p.status = "paid"
        p.paid_at = datetime.utcnow()
        p.confirmed_by = current_user.id
        p.postponed_until = None
    db.commit()
    p = load_payment(db, payment_id)
    return enrich(p)


@router.delete("/{payment_id}")
def delete_payment(
    payment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_payment_write),
):
    p = db.query(Payment).filter(Payment.id == payment_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    assert_partner_access(db, current_user, p.partner_id)
    p.is_archived = True
    db.commit()
    return {"ok": True}
