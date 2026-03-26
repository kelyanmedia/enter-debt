"""Ограничение данных по роли: менеджер видит только назначенных партнёров (или всех при see_all_partners)."""
from typing import Optional, Set

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import false

from app.models.user import User
from app.models.partner import Partner
from app.models.payment import Payment


def accessible_partner_ids(db: Session, user: User) -> Optional[Set[int]]:
    """
    None — без фильтра (админ, бухгалтерия, менеджер с «видит всех»).
    set() — нет доступа ни к одному партнёру.
    {ids} — только эти партнёры.
    """
    if user.role in ("admin", "accountant"):
        return None
    if user.role != "manager":
        return set()
    if getattr(user, "see_all_partners", False):
        return None
    rows = (
        db.query(Partner.id)
        .filter(Partner.manager_id == user.id, Partner.is_deleted == False)
        .all()
    )
    return {r[0] for r in rows}


def assert_partner_access(db: Session, user: User, partner_id: int) -> None:
    ids = accessible_partner_ids(db, user)
    if ids is None:
        return
    if partner_id not in ids:
        raise HTTPException(status_code=404, detail="Not found")


def assert_payment_access(db: Session, user: User, payment: Payment) -> None:
    assert_partner_access(db, user, payment.partner_id)


def filter_payments_query(q, db: Session, user: User):
    ids = accessible_partner_ids(db, user)
    if ids is None:
        return q
    if len(ids) == 0:
        return q.filter(false())
    return q.filter(Payment.partner_id.in_(ids))


def filter_partners_query(q, db: Session, user: User):
    ids = accessible_partner_ids(db, user)
    if ids is None:
        return q
    if len(ids) == 0:
        return q.filter(false())
    return q.filter(Partner.id.in_(ids))
