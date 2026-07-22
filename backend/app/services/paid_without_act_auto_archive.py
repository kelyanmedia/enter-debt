"""Автоархив проектов: оплата есть, АКТ/СФ не отмечен больше 5 минут."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import joinedload

from app.db.database import iter_company_sessionmakers, reset_company_context, set_company_context
from app.models.payment import Payment

log = logging.getLogger(__name__)

AUTO_ARCHIVE_AFTER = timedelta(minutes=5)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def should_auto_archive_payment(pay: Any, cutoff: datetime) -> bool:
    """True если все месяцы оплачены и есть оплата без АКТ/СФ старше cutoff."""
    if getattr(pay, "is_archived", False):
        return False
    if getattr(pay, "trashed_at", None) is not None:
        return False
    if getattr(pay, "status", None) == "archived":
        return False
    months = list(getattr(pay, "months", None) or [])
    if not months:
        return False
    if any(getattr(m, "status", None) != "paid" for m in months):
        return False
    for m in months:
        if getattr(m, "act_issued", False):
            continue
        paid_at = _aware(getattr(m, "paid_at", None))
        if paid_at is None:
            continue
        if paid_at <= cutoff:
            return True
    return False


def process_paid_without_act_auto_archive(now: datetime | None = None) -> dict[str, Any]:
    """
    Если по проекту все месяцы оплачены, а хотя бы у одной оплаченной строки
    нет АКТ/СФ дольше 5 минут после paid_at — проект уходит в архив.
    """
    now = now or datetime.now(timezone.utc)
    cutoff = now - AUTO_ARCHIVE_AFTER
    archived_ids: list[int] = []
    scanned = 0

    for slug, SessionLocal in iter_company_sessionmakers():
        token = set_company_context(slug)
        db = SessionLocal()
        try:
            candidates = (
                db.query(Payment)
                .options(joinedload(Payment.months))
                .filter(
                    Payment.company_slug == slug,
                    Payment.is_archived == False,
                    Payment.trashed_at.is_(None),
                    Payment.status != "archived",
                )
                .all()
            )
            changed = False
            for pay in candidates:
                months = list(pay.months or [])
                if months and all(m.status == "paid" for m in months):
                    scanned += 1
                if not should_auto_archive_payment(pay, cutoff):
                    continue
                pay.is_archived = True
                archived_ids.append(int(pay.id))
                changed = True
            if changed:
                db.commit()
            else:
                db.rollback()
        except Exception as exc:
            db.rollback()
            log.warning("paid_without_act_auto_archive [%s]: %s", slug, exc)
        finally:
            db.close()
            reset_company_context(token)

    return {"scanned": scanned, "archived_ids": archived_ids, "archived": len(archived_ids)}
