from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from datetime import date, datetime
from app.db.database import get_db, get_request_company
from app.models.payment import Payment, NotificationLog
from app.models.partner import Partner
from app.schemas.schemas import PaymentOut, PartnerOut
from app.core.security import get_current_user, require_admin

router = APIRouter(prefix="/api/archive", tags=["archive"])


def enrich(p: Payment):
    from app.api.routes.payments import enrich as base_enrich
    return base_enrich(p)


@router.get("/payments", response_model=List[PaymentOut])
def get_archived_payments(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    partner_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _=Depends(require_admin)
):
    q = db.query(Payment).options(
        joinedload(Payment.partner).joinedload(Partner.manager),
        joinedload(Payment.confirmed_by_user),
        joinedload(Payment.months),
    ).filter(
        Payment.is_archived == True,
        Payment.trashed_at.is_(None),
        Payment.company_slug == get_request_company(),
    )

    if date_from:
        q = q.filter(Payment.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        q = q.filter(Payment.created_at <= datetime.combine(date_to, datetime.max.time()))
    if partner_id:
        q = q.filter(Payment.partner_id == partner_id)

    payments = q.order_by(Payment.updated_at.desc().nullslast(), Payment.created_at.desc()).all()
    return [enrich(p) for p in payments]


@router.get("/partners", response_model=List[PartnerOut])
def get_archived_partners(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    db: Session = Depends(get_db),
    _=Depends(require_admin)
):
    q = db.query(Partner).options(
        joinedload(Partner.manager)
    ).filter(
        Partner.status == "archive",
        Partner.is_deleted == False,
        Partner.trashed_at.is_(None),
        Partner.company_slug == get_request_company(),
    )

    if date_from:
        q = q.filter(Partner.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        q = q.filter(Partner.created_at <= datetime.combine(date_to, datetime.max.time()))

    partners = q.order_by(Partner.updated_at.desc().nullslast(), Partner.created_at.desc()).all()
    result = []
    for partner in partners:
        out = PartnerOut.model_validate(partner)
        out.open_payments_count = sum(
            1
            for p in partner.payments
            if p.trashed_at is None and not p.is_archived and p.status not in ("paid",)
        )
        out.overdue_count = sum(
            1 for p in partner.payments if p.trashed_at is None and p.status == "overdue"
        )
        result.append(out)
    return result


@router.post("/payments/{payment_id}")
def archive_payment(
    payment_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin)
):
    p = (
        db.query(Payment)
        .filter(
            Payment.id == payment_id,
            Payment.company_slug == get_request_company(),
        )
        .first()
    )
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    p.is_archived = True
    db.commit()
    return {"ok": True}


@router.delete("/payments/{payment_id}")
def permanently_delete_archived_payment(
    payment_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin)
):
    """Удаление из БД только для уже архивных проектов."""
    p = (
        db.query(Payment)
        .filter(
            Payment.id == payment_id,
            Payment.company_slug == get_request_company(),
        )
        .first()
    )
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    if not p.is_archived:
        raise HTTPException(
            status_code=400,
            detail="Можно безвозвратно удалить только архивный проект",
        )
    if p.trashed_at is not None:
        raise HTTPException(
            status_code=400,
            detail="Сначала восстановите проект из корзины или удалите его там",
        )
    db.query(NotificationLog).filter(
        NotificationLog.payment_id == payment_id,
        NotificationLog.company_slug == get_request_company(),
    ).delete(
        synchronize_session=False
    )
    db.delete(p)
    db.commit()
    return {"ok": True}


@router.post("/partners/{partner_id}")
def archive_partner(
    partner_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin)
):
    partner = (
        db.query(Partner)
        .filter(
            Partner.id == partner_id,
            Partner.company_slug == get_request_company(),
        )
        .first()
    )
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")
    partner.status = "archive"
    db.commit()
    return {"ok": True}


@router.post("/partners/{partner_id}/restore")
def restore_partner(
    partner_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin)
):
    partner = (
        db.query(Partner)
        .filter(
            Partner.id == partner_id,
            Partner.company_slug == get_request_company(),
        )
        .first()
    )
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")
    partner.status = "active"
    db.commit()
    return {"ok": True}
