"""Ограничение данных по роли: менеджер видит только назначенных партнёров (или всех при see_all_partners)."""
import json
from typing import List, Optional, Set

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import false

from app.models.user import User
from app.models.partner import Partner
from app.models.payment import Payment


def parse_visible_manager_ids(user: User) -> List[int]:
    """Список id менеджеров, чьих партнёров видит роль administration."""
    if user.role != "administration":
        return []
    raw = getattr(user, "visible_manager_ids", None) or ""
    if isinstance(raw, str):
        s = raw.strip()
        if not s:
            return []
        try:
            return [int(x) for x in json.loads(s)]
        except (TypeError, ValueError, json.JSONDecodeError):
            return []
    return []


def assert_manager_assignable_by_administration(db: Session, user: User, manager_id: Optional[int]) -> None:
    """При создании/редактировании компании ролью administration — менеджер обязателен и из списка."""
    if user.role != "administration":
        return
    if manager_id is None:
        raise HTTPException(
            status_code=400,
            detail="Укажите менеджера компании из доступных вам.",
        )
    mids = parse_visible_manager_ids(user)
    if manager_id not in mids:
        raise HTTPException(
            status_code=403,
            detail="Можно назначить только менеджера из списка, заданного для вашей учётной записи.",
        )
    m = db.query(User).filter(User.id == manager_id, User.role == "manager", User.is_active == True).first()
    if not m:
        raise HTTPException(status_code=400, detail="Указанный менеджер не найден или неактивен")


def accessible_partner_ids(db: Session, user: User) -> Optional[Set[int]]:
    """
    None — без фильтра (админ, бухгалтерия, менеджер с «видит всех»).
    set() — нет доступа ни к одному партнёру.
    {ids} — только эти партнёры.
    """
    if user.role in ("admin", "accountant"):
        return None
    if user.role == "administration":
        mids = parse_visible_manager_ids(user)
        if not mids:
            return set()
        rows = (
            db.query(Partner.id)
            .filter(Partner.manager_id.in_(mids), Partner.is_deleted == False)
            .all()
        )
        return {r[0] for r in rows}
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
    partner = db.query(Partner).filter(Partner.id == partner_id, Partner.is_deleted == False).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Компания не найдена или удалена")

    ids = accessible_partner_ids(db, user)
    if ids is None:
        return
    if len(ids) == 0:
        raise HTTPException(
            status_code=403,
            detail="Вам не назначены компании. Обратитесь к администратору, чтобы привязать партнёров к вашему профилю.",
        )
    if partner_id not in ids:
        raise HTTPException(
            status_code=403,
            detail="Нет доступа к этой компании. Выберите партнёра из списка или обратитесь к администратору.",
        )


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
