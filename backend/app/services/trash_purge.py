"""Очистка корзины: записи старше TRASH_RETENTION_DAYS удаляются из БД."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.db.database import get_request_company
from app.models.partner import Partner
from app.models.payment import NotificationLog, Payment
from app.models.sales_company import SalesCompany

TRASH_RETENTION_DAYS = 30


def purge_expired_trash(db: Session) -> dict:
    cutoff = datetime.now(timezone.utc) - timedelta(days=TRASH_RETENTION_DAYS)
    removed_p = 0
    removed_part = 0
    removed_clients = 0
    for p in (
        db.query(Payment)
        .filter(
            Payment.trashed_at.isnot(None),
            Payment.trashed_at < cutoff,
            Payment.company_slug == get_request_company(),
        )
        .all()
    ):
        db.query(NotificationLog).filter(
            NotificationLog.payment_id == p.id,
            NotificationLog.company_slug == get_request_company(),
        ).delete(synchronize_session=False)
        db.delete(p)
        removed_p += 1
    for part in (
        db.query(Partner)
        .filter(
            Partner.trashed_at.isnot(None),
            Partner.trashed_at < cutoff,
            Partner.company_slug == get_request_company(),
        )
        .all()
    ):
        for pay in list(part.payments or []):
            db.query(NotificationLog).filter(
                NotificationLog.payment_id == pay.id,
                NotificationLog.company_slug == get_request_company(),
            ).delete(synchronize_session=False)
            db.delete(pay)
        db.delete(part)
        removed_part += 1
    for client in (
        db.query(SalesCompany)
        .filter(
            SalesCompany.trashed_at.isnot(None),
            SalesCompany.trashed_at < cutoff,
            SalesCompany.company_slug == get_request_company(),
        )
        .all()
    ):
        db.delete(client)
        removed_clients += 1
    db.commit()
    return {"purged_payments": removed_p, "purged_partners": removed_part, "purged_clients": removed_clients}
