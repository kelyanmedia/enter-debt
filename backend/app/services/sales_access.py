"""Доступ к CRM продаж и фильтрация сделок (МОП / РОП)."""
from __future__ import annotations

from typing import Iterable, Optional, Set

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.sale_pipeline import SaleDeal
from app.models.user import User

_CRM_PIPELINE_ROLES = frozenset({"admin", "mop"})
_CRM_PERM_ROLES = frozenset({"manager", "administration"})


def has_sales_companies_access(user: User) -> bool:
    if user.role in ("admin", "mop"):
        return True
    if user.role in _CRM_PERM_ROLES and bool(getattr(user, "can_view_sales", False)):
        return True
    return False


def has_crm_pipeline_access(user: User) -> bool:
    if user.role in _CRM_PIPELINE_ROLES:
        return True
    if user.role in _CRM_PERM_ROLES and bool(getattr(user, "can_view_crm", False)):
        return True
    return False


def is_sales_rop(user: User) -> bool:
    return bool(getattr(user, "is_sales_rop", False))


def can_manage_crm_structure(user: User) -> bool:
    return user.role in ("admin", "mop")


def require_sales_companies(user: User) -> User:
    if not has_sales_companies_access(user):
        raise HTTPException(status_code=403, detail="Нет доступа к разделу «Продажи»")
    return user


def require_crm_pipeline(user: User) -> User:
    if not has_crm_pipeline_access(user):
        raise HTTPException(status_code=403, detail="Нет доступа к CRM (воронка и сделки)")
    return user


def require_crm_manage(user: User) -> User:
    if not can_manage_crm_structure(user):
        raise HTTPException(status_code=403, detail="Только администратор или МОП")
    return user


def get_mop_user_ids(db: Session, company_slug: str) -> Set[int]:
    rows = (
        db.query(User.id)
        .filter(
            User.company_slug == company_slug,
            User.role == "mop",
            User.is_active == True,
        )
        .all()
    )
    return {int(r[0]) for r in rows}


def normalize_deal_scope(scope: Optional[str], user: User) -> str:
    s = (scope or "").strip().lower()
    if is_sales_rop(user):
        return "mine" if s == "mine" else "team"
    return "all"


def deal_visible_for_user(
    deal: SaleDeal,
    user: User,
    mop_ids: Iterable[int],
    scope: str,
) -> bool:
    aid = deal.assigned_user_id
    mop_set = set(mop_ids)

    if user.role == "admin":
        return True

    if is_sales_rop(user):
        if scope == "mine":
            return aid == user.id
        # team: сделки всех МОПов (свои — только во вкладке «Мои»)
        return aid in mop_set and aid != user.id

    if user.role == "mop":
        return aid == user.id

    if user.role in _CRM_PERM_ROLES:
        return aid == user.id

    return False


def filter_deals(
    deals: list[SaleDeal],
    user: User,
    mop_ids: Iterable[int],
    scope: str,
) -> list[SaleDeal]:
    return [d for d in deals if deal_visible_for_user(d, user, mop_ids, scope)]


def assert_manager_filter(
    user: User,
    mop_ids: Iterable[int],
    assigned_user_id: Optional[int],
    scope: str,
) -> None:
    if assigned_user_id is None:
        return
    mop_set = set(mop_ids)
    if user.role == "admin":
        return
    if is_sales_rop(user):
        if scope == "mine":
            if assigned_user_id != user.id:
                raise HTTPException(status_code=403, detail="Нет доступа к сделкам этого менеджера")
            return
        if assigned_user_id not in mop_set or assigned_user_id == user.id:
            raise HTTPException(status_code=403, detail="Нет доступа к сделкам этого менеджера")
        return
    if assigned_user_id != user.id:
        raise HTTPException(status_code=403, detail="Нет доступа к сделкам этого менеджера")


def assert_deal_access(db: Session, user: User, deal: SaleDeal) -> None:
    if user.role == "admin":
        return
    mop_ids = get_mop_user_ids(db, deal.company_slug)
    aid = deal.assigned_user_id
    if is_sales_rop(user):
        if aid == user.id or aid in mop_ids:
            return
        raise HTTPException(status_code=403, detail="Нет доступа к этой сделке")
    if user.role == "mop" or user.role in _CRM_PERM_ROLES:
        if aid == user.id:
            return
        raise HTTPException(status_code=403, detail="Нет доступа к этой сделке")
    raise HTTPException(status_code=403, detail="Нет доступа к этой сделке")
