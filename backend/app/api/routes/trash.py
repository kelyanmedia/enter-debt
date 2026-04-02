"""Корзина: только админ. Проекты и партнёры с trashed_at; через 30 суток — автоудаление."""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.api.routes.payments import enrich as enrich_payment
from app.core.security import require_admin
from app.db.database import get_db
from app.models.partner import Partner
from app.models.payment import NotificationLog, Payment
from app.models.user import User
from app.schemas.schemas import PartnerOut, PaymentOut
from app.services.trash_purge import TRASH_RETENTION_DAYS, purge_expired_trash

router = APIRouter(prefix="/api/trash", tags=["trash"])


def _enrich_partner_trash(db: Session, partner: Partner) -> PartnerOut:
    out = PartnerOut.model_validate(partner)
    out.open_payments_count = sum(
        1
        for p in partner.payments or []
        if not p.is_archived and p.status not in ("paid",) and p.trashed_at is None
    )
    out.overdue_count = sum(1 for p in partner.payments or [] if p.status == "overdue")
    return out


@router.get("/payments", response_model=List[PaymentOut])
def list_trashed_payments(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    rows = (
        db.query(Payment)
        .options(
            joinedload(Payment.partner).joinedload(Partner.manager),
            joinedload(Payment.confirmed_by_user),
            joinedload(Payment.months),
        )
        .filter(Payment.trashed_at.isnot(None))
        .order_by(Payment.trashed_at.desc())
        .all()
    )
    return [enrich_payment(p) for p in rows]


@router.get("/partners", response_model=List[PartnerOut])
def list_trashed_partners(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    rows = (
        db.query(Partner)
        .options(joinedload(Partner.manager))
        .filter(Partner.trashed_at.isnot(None))
        .order_by(Partner.trashed_at.desc())
        .all()
    )
    return [_enrich_partner_trash(db, p) for p in rows]


@router.post("/payments/{payment_id}/restore")
def restore_trashed_payment(
    payment_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    p = db.query(Payment).filter(Payment.id == payment_id).first()
    if not p or p.trashed_at is None:
        raise HTTPException(status_code=404, detail="Запись не найдена в корзине")
    partner = db.query(Partner).filter(Partner.id == p.partner_id).first()
    if partner and partner.trashed_at is not None:
        raise HTTPException(
            status_code=400,
            detail="Сначала восстановите компанию из корзины",
        )
    p.trashed_at = None
    db.commit()
    return {"ok": True}


@router.post("/partners/{partner_id}/restore")
def restore_trashed_partner(
    partner_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    partner = db.query(Partner).filter(Partner.id == partner_id).first()
    if not partner or partner.trashed_at is None:
        raise HTTPException(status_code=404, detail="Компания не найдена в корзине")
    partner.trashed_at = None
    db.commit()
    return {"ok": True}


@router.delete("/payments/{payment_id}")
def permanently_delete_trashed_payment(
    payment_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    p = db.query(Payment).filter(Payment.id == payment_id).first()
    if not p or p.trashed_at is None:
        raise HTTPException(status_code=404, detail="Запись не найдена в корзине")
    db.query(NotificationLog).filter(NotificationLog.payment_id == payment_id).delete(synchronize_session=False)
    db.delete(p)
    db.commit()
    return {"ok": True}


@router.delete("/partners/{partner_id}")
def permanently_delete_trashed_partner(
    partner_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    partner = db.query(Partner).filter(Partner.id == partner_id).first()
    if not partner or partner.trashed_at is None:
        raise HTTPException(status_code=404, detail="Компания не найдена в корзине")
    for pay in list(partner.payments or []):
        db.query(NotificationLog).filter(NotificationLog.payment_id == pay.id).delete(synchronize_session=False)
        db.delete(pay)
    db.delete(partner)
    db.commit()
    return {"ok": True}


@router.post("/purge-expired")
def run_purge_expired(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Ручной запуск того же правила, что и по расписанию (старше 30 суток)."""
    return purge_expired_trash(db)


@router.get("/meta")
def trash_meta(_: User = Depends(require_admin)):
    return {
        "retention_days": TRASH_RETENTION_DAYS,
        "note": "Удалённые проекты и компании хранятся здесь; архив (раздел «Архив») — отдельно.",
    }
