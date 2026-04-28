"""Продажи: клиентская база и личные списки компаний менеджеров."""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.db.database import get_db, get_request_company
from app.core.security import get_current_user
from app.models.sales_company import SalesCompany, SalesCompanyGroup, SalesCompanyInteraction, SalesWishlistItem
from app.models.user import User

router = APIRouter(prefix="/api/sales/companies", tags=["sales"])


class SalesCompanyIn(BaseModel):
    company_name: str = Field(..., min_length=1, max_length=300)
    brand_name: Optional[str] = Field(None, max_length=220)
    client_type: Optional[str] = Field(None, max_length=1)
    group_id: Optional[int] = None
    status: Optional[str] = Field(None, max_length=120)
    comment: Optional[str] = None
    assigned_manager_id: Optional[int] = None
    brought_by_manager_id: Optional[int] = None
    brought_by_name: Optional[str] = Field(None, max_length=220)
    position: Optional[str] = Field(None, max_length=220)
    contact_name: Optional[str] = Field(None, max_length=220)
    phone: Optional[str] = Field(None, max_length=80)
    email: Optional[str] = Field(None, max_length=220)
    contact_actuality_date: Optional[date] = None
    contact: Optional[str] = None
    lpr_name: Optional[str] = Field(None, max_length=220)
    lpr_role: Optional[str] = Field(None, max_length=160)
    lvr_name: Optional[str] = Field(None, max_length=220)
    lvr_role: Optional[str] = Field(None, max_length=160)
    previous_jobs: Optional[str] = None


class SalesCompanyGroupIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    note: Optional[str] = None


class SalesCompanyGroupOut(BaseModel):
    id: int
    name: str
    note: Optional[str] = None
    company_count: int = 0


class SalesCompaniesManagerAssignIn(BaseModel):
    target_manager_id: Optional[int] = None
    company_ids: List[int] = Field(default_factory=list)
    source_manager_id: Optional[int] = None


class SalesCompaniesGroupAssignIn(BaseModel):
    group_id: Optional[int] = None
    company_ids: List[int] = Field(default_factory=list)


class SalesCompanyInteractionIn(BaseModel):
    interaction_date: date
    project_name: Optional[str] = Field(None, max_length=300)
    status: Optional[str] = Field(None, max_length=120)
    note: Optional[str] = None


class SalesCompanyInteractionOut(BaseModel):
    id: int
    interaction_date: date
    project_name: Optional[str] = None
    status: Optional[str] = None
    note: Optional[str] = None
    created_at: Optional[str] = None


class SalesCompanyOut(BaseModel):
    id: int
    company_name: str
    brand_name: Optional[str] = None
    client_type: Optional[str] = None
    group_id: Optional[int] = None
    group_name: Optional[str] = None
    status: Optional[str] = None
    comment: Optional[str] = None
    assigned_manager_id: Optional[int] = None
    assigned_manager_name: Optional[str] = None
    brought_by_manager_id: Optional[int] = None
    brought_by_manager_name: Optional[str] = None
    brought_by_name: Optional[str] = None
    position: Optional[str] = None
    contact_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    contact_actuality_date: Optional[date] = None
    contact: Optional[str] = None
    lpr_name: Optional[str] = None
    lpr_role: Optional[str] = None
    lvr_name: Optional[str] = None
    lvr_role: Optional[str] = None
    previous_jobs: Optional[str] = None
    interactions: List[SalesCompanyInteractionOut] = Field(default_factory=list)
    created_at: Optional[str] = None


class SalesWishlistIn(BaseModel):
    company_name: str = Field(..., min_length=1, max_length=300)
    potential_entry: Optional[str] = Field(None, max_length=300)
    reason: Optional[str] = None
    comment: Optional[str] = None
    offer: Optional[str] = None
    assigned_manager_id: Optional[int] = None


class SalesWishlistActivateIn(BaseModel):
    assigned_manager_id: Optional[int] = None
    status: Optional[str] = Field(None, max_length=120)
    position: Optional[str] = Field(None, max_length=220)
    contact_name: Optional[str] = Field(None, max_length=220)
    phone: Optional[str] = Field(None, max_length=80)
    email: Optional[str] = Field(None, max_length=220)
    contact: Optional[str] = None
    lpr_name: Optional[str] = Field(None, max_length=220)
    lpr_role: Optional[str] = Field(None, max_length=160)
    lvr_name: Optional[str] = Field(None, max_length=220)
    lvr_role: Optional[str] = Field(None, max_length=160)
    comment: Optional[str] = None


class SalesWishlistOut(BaseModel):
    id: int
    company_name: str
    potential_entry: Optional[str] = None
    reason: Optional[str] = None
    comment: Optional[str] = None
    offer: Optional[str] = None
    assigned_manager_id: Optional[int] = None
    assigned_manager_name: Optional[str] = None
    created_by_user_id: Optional[int] = None
    created_by_user_name: Optional[str] = None
    activated_company_id: Optional[int] = None
    activated_at: Optional[str] = None
    created_at: Optional[str] = None


def _require_sales_access(user: User) -> None:
    if user.role == "admin":
        return
    if user.role == "manager" and bool(getattr(user, "can_view_sales", False)):
        return
    if user.role == "administration" and bool(getattr(user, "can_view_sales", False)):
        return
    if user.role in ("manager", "administration"):
        raise HTTPException(status_code=403, detail="Нет доступа к разделу «Продажи». Попросите администратора выдать доступ.")
    if user.role not in ("admin", "manager", "administration"):
        raise HTTPException(status_code=403, detail="Нет доступа")


def _validate_manager(db: Session, manager_id: Optional[int]) -> Optional[int]:
    if manager_id is None:
        return None
    manager = (
        db.query(User)
        .filter(
            User.id == manager_id,
            User.role == "manager",
            User.is_active == True,
            User.company_slug == get_request_company(),
        )
        .first()
    )
    if not manager:
        raise HTTPException(status_code=400, detail="Менеджер не найден")
    return int(manager_id)


def _clean_text(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _clean_client_type(v: Optional[str]) -> Optional[str]:
    s = _clean_text(v)
    if s is None:
        return None
    up = s.upper()
    if up not in ("A", "B", "C"):
        raise HTTPException(status_code=400, detail="Тип клиента: A, B или C")
    return up


def _validate_group(db: Session, group_id: Optional[int]) -> Optional[int]:
    if group_id is None:
        return None
    group = (
        db.query(SalesCompanyGroup)
        .filter(SalesCompanyGroup.id == group_id, SalesCompanyGroup.company_slug == get_request_company())
        .first()
    )
    if not group:
        raise HTTPException(status_code=400, detail="Ниша не найдена")
    return int(group_id)


def _require_admin(user: User) -> None:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Только админ может передавать компании между менеджерами")


def _to_out(row: SalesCompany) -> SalesCompanyOut:
    mgr = getattr(row, "assigned_manager", None)
    brought = getattr(row, "brought_by_manager", None)
    group = getattr(row, "group", None)
    return SalesCompanyOut(
        id=int(row.id),
        company_name=row.company_name,
        brand_name=row.brand_name,
        client_type=row.client_type,
        group_id=row.group_id,
        group_name=(group.name if group else None),
        status=row.status,
        comment=row.comment,
        assigned_manager_id=row.assigned_manager_id,
        assigned_manager_name=(mgr.name if mgr else None),
        brought_by_manager_id=row.brought_by_manager_id,
        brought_by_manager_name=(brought.name if brought else None),
        brought_by_name=row.brought_by_name,
        position=row.position,
        contact_name=row.contact_name,
        phone=row.phone,
        email=row.email,
        contact_actuality_date=row.contact_actuality_date,
        contact=row.contact,
        lpr_name=row.lpr_name,
        lpr_role=row.lpr_role,
        lvr_name=row.lvr_name,
        lvr_role=row.lvr_role,
        previous_jobs=row.previous_jobs,
        interactions=[
            SalesCompanyInteractionOut(
                id=int(i.id),
                interaction_date=i.interaction_date,
                project_name=i.project_name,
                status=i.status,
                note=i.note,
                created_at=i.created_at.isoformat() if i.created_at else None,
            )
            for i in sorted(
                row.interactions or [],
                key=lambda x: (x.interaction_date, x.id),
                reverse=True,
            )
        ],
        created_at=row.created_at.isoformat() if row.created_at else None,
    )


def _to_wishlist_out(row: SalesWishlistItem) -> SalesWishlistOut:
    mgr = getattr(row, "assigned_manager", None)
    creator = getattr(row, "created_by_user", None)
    return SalesWishlistOut(
        id=int(row.id),
        company_name=row.company_name,
        potential_entry=row.potential_entry,
        reason=row.reason,
        comment=row.comment,
        offer=row.offer,
        assigned_manager_id=row.assigned_manager_id,
        assigned_manager_name=(mgr.name if mgr else None),
        created_by_user_id=row.created_by_user_id,
        created_by_user_name=(creator.name if creator else None),
        activated_company_id=row.activated_company_id,
        activated_at=row.activated_at.isoformat() if row.activated_at else None,
        created_at=row.created_at.isoformat() if row.created_at else None,
    )


@router.get("", response_model=List[SalesCompanyOut])
def list_sales_companies(
    scope: str = Query("mine", pattern="^(all|mine)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_sales_access(current_user)
    q = (
        db.query(SalesCompany)
        .options(
            joinedload(SalesCompany.assigned_manager),
            joinedload(SalesCompany.brought_by_manager),
            joinedload(SalesCompany.group),
            joinedload(SalesCompany.interactions),
        )
        .filter(SalesCompany.company_slug == get_request_company(), SalesCompany.trashed_at.is_(None))
    )
    if current_user.role != "admin" or scope != "all":
        q = q.filter(SalesCompany.assigned_manager_id == current_user.id)
    rows = q.order_by(SalesCompany.id.desc()).all()
    return [_to_out(r) for r in rows]


@router.get("/groups", response_model=List[SalesCompanyGroupOut])
def list_sales_company_groups(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_sales_access(current_user)
    groups = (
        db.query(SalesCompanyGroup)
        .filter(SalesCompanyGroup.company_slug == get_request_company())
        .order_by(SalesCompanyGroup.name.asc(), SalesCompanyGroup.id.asc())
        .all()
    )
    counts = dict(
        db.query(SalesCompany.group_id, func.count(SalesCompany.id))
        .filter(
            SalesCompany.company_slug == get_request_company(),
            SalesCompany.group_id.isnot(None),
            SalesCompany.trashed_at.is_(None),
        )
        .group_by(SalesCompany.group_id)
        .all()
    )
    return [
        SalesCompanyGroupOut(
            id=int(g.id),
            name=g.name,
            note=g.note,
            company_count=int(counts.get(g.id, 0)),
        )
        for g in groups
    ]


@router.post("/groups", response_model=SalesCompanyGroupOut)
def create_sales_company_group(
    body: SalesCompanyGroupIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_sales_access(current_user)
    name = body.name.strip()
    exists = (
        db.query(SalesCompanyGroup)
        .filter(SalesCompanyGroup.company_slug == get_request_company(), SalesCompanyGroup.name == name)
        .first()
    )
    if exists:
        raise HTTPException(status_code=400, detail="Такая ниша уже есть")
    row = SalesCompanyGroup(
        company_slug=get_request_company(),
        name=name,
        note=_clean_text(body.note),
        created_by_user_id=current_user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return SalesCompanyGroupOut(id=int(row.id), name=row.name, note=row.note, company_count=0)


@router.delete("/groups/{group_id}")
def delete_sales_company_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_sales_access(current_user)
    row = (
        db.query(SalesCompanyGroup)
        .filter(SalesCompanyGroup.id == group_id, SalesCompanyGroup.company_slug == get_request_company())
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Ниша не найдена")
    db.query(SalesCompany).filter(
        SalesCompany.company_slug == get_request_company(),
        SalesCompany.group_id == group_id,
    ).update({SalesCompany.group_id: None}, synchronize_session=False)
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/bulk/assign-manager")
def bulk_assign_sales_companies_manager(
    body: SalesCompaniesManagerAssignIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_sales_access(current_user)
    _require_admin(current_user)
    target_manager_id = _validate_manager(db, body.target_manager_id)
    ids = [int(x) for x in body.company_ids if int(x) > 0]
    q = db.query(SalesCompany).filter(SalesCompany.company_slug == get_request_company())
    q = q.filter(SalesCompany.trashed_at.is_(None))
    if body.source_manager_id is not None:
        source_manager_id = _validate_manager(db, body.source_manager_id)
        q = q.filter(SalesCompany.assigned_manager_id == source_manager_id)
    elif ids:
        q = q.filter(SalesCompany.id.in_(ids))
    else:
        raise HTTPException(status_code=400, detail="Выберите компании или менеджера-источник")
    count = q.update({SalesCompany.assigned_manager_id: target_manager_id}, synchronize_session=False)
    db.commit()
    return {"ok": True, "updated": int(count or 0)}


@router.post("/bulk/assign-group")
def bulk_assign_sales_companies_group(
    body: SalesCompaniesGroupAssignIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_sales_access(current_user)
    if not body.company_ids:
        raise HTTPException(status_code=400, detail="Выберите компании")
    group_id = _validate_group(db, body.group_id)
    q = db.query(SalesCompany).filter(
        SalesCompany.company_slug == get_request_company(),
        SalesCompany.trashed_at.is_(None),
        SalesCompany.id.in_([int(x) for x in body.company_ids if int(x) > 0]),
    )
    if current_user.role != "admin":
        q = q.filter(SalesCompany.assigned_manager_id == current_user.id)
    count = q.update({SalesCompany.group_id: group_id}, synchronize_session=False)
    db.commit()
    return {"ok": True, "updated": int(count or 0)}


@router.post("", response_model=SalesCompanyOut)
def create_sales_company(
    body: SalesCompanyIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_sales_access(current_user)
    assigned_manager_id = (
        _validate_manager(db, body.assigned_manager_id)
        if current_user.role == "admin"
        else int(current_user.id)
    )
    row = SalesCompany(
        company_slug=get_request_company(),
        company_name=body.company_name.strip(),
        brand_name=_clean_text(body.brand_name),
        client_type=_clean_client_type(body.client_type),
        group_id=_validate_group(db, body.group_id),
        status=_clean_text(body.status),
        comment=_clean_text(body.comment),
        assigned_manager_id=assigned_manager_id,
        brought_by_manager_id=_validate_manager(db, body.brought_by_manager_id),
        brought_by_name=_clean_text(body.brought_by_name),
        position=_clean_text(body.position),
        contact_name=_clean_text(body.contact_name),
        phone=_clean_text(body.phone),
        email=_clean_text(body.email),
        contact_actuality_date=body.contact_actuality_date,
        contact=_clean_text(body.contact),
        lpr_name=_clean_text(body.lpr_name),
        lpr_role=_clean_text(body.lpr_role),
        lvr_name=_clean_text(body.lvr_name),
        lvr_role=_clean_text(body.lvr_role),
        previous_jobs=_clean_text(body.previous_jobs),
        created_by_user_id=current_user.id,
    )
    db.add(row)
    db.commit()
    row = (
        db.query(SalesCompany)
        .options(
            joinedload(SalesCompany.assigned_manager),
            joinedload(SalesCompany.brought_by_manager),
            joinedload(SalesCompany.group),
            joinedload(SalesCompany.interactions),
        )
        .filter(SalesCompany.id == row.id, SalesCompany.company_slug == get_request_company())
        .first()
    )
    return _to_out(row)  # type: ignore[arg-type]


@router.put("/{company_id}", response_model=SalesCompanyOut)
def update_sales_company(
    company_id: int,
    body: SalesCompanyIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_sales_access(current_user)
    q = db.query(SalesCompany).filter(
        SalesCompany.id == company_id,
        SalesCompany.company_slug == get_request_company(),
        SalesCompany.trashed_at.is_(None),
    )
    if current_user.role != "admin":
        q = q.filter(SalesCompany.assigned_manager_id == current_user.id)
    row = q.first()
    if not row:
        raise HTTPException(status_code=404, detail="Компания не найдена")
    row.company_name = body.company_name.strip()
    row.brand_name = _clean_text(body.brand_name)
    row.client_type = _clean_client_type(body.client_type)
    row.group_id = _validate_group(db, body.group_id)
    row.status = _clean_text(body.status)
    row.comment = _clean_text(body.comment)
    if current_user.role == "admin":
        row.assigned_manager_id = _validate_manager(db, body.assigned_manager_id)
    row.brought_by_manager_id = _validate_manager(db, body.brought_by_manager_id)
    row.brought_by_name = _clean_text(body.brought_by_name)
    row.position = _clean_text(body.position)
    row.contact_name = _clean_text(body.contact_name)
    row.phone = _clean_text(body.phone)
    row.email = _clean_text(body.email)
    row.contact_actuality_date = body.contact_actuality_date
    row.contact = _clean_text(body.contact)
    row.lpr_name = _clean_text(body.lpr_name)
    row.lpr_role = _clean_text(body.lpr_role)
    row.lvr_name = _clean_text(body.lvr_name)
    row.lvr_role = _clean_text(body.lvr_role)
    row.previous_jobs = _clean_text(body.previous_jobs)
    db.commit()
    row = (
        db.query(SalesCompany)
        .options(
            joinedload(SalesCompany.assigned_manager),
            joinedload(SalesCompany.brought_by_manager),
            joinedload(SalesCompany.group),
            joinedload(SalesCompany.interactions),
        )
        .filter(SalesCompany.id == company_id, SalesCompany.company_slug == get_request_company())
        .first()
    )
    return _to_out(row)  # type: ignore[arg-type]


def _get_accessible_company(db: Session, company_id: int, user: User) -> SalesCompany:
    q = db.query(SalesCompany).filter(
        SalesCompany.id == company_id,
        SalesCompany.company_slug == get_request_company(),
        SalesCompany.trashed_at.is_(None),
    )
    if user.role != "admin":
        q = q.filter(SalesCompany.assigned_manager_id == user.id)
    row = q.first()
    if not row:
        raise HTTPException(status_code=404, detail="Компания не найдена")
    return row


@router.post("/{company_id}/interactions", response_model=SalesCompanyOut)
def add_interaction(
    company_id: int,
    body: SalesCompanyInteractionIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_sales_access(current_user)
    company = _get_accessible_company(db, company_id, current_user)
    row = SalesCompanyInteraction(
        company_slug=get_request_company(),
        sales_company_id=company.id,
        interaction_date=body.interaction_date,
        project_name=_clean_text(body.project_name),
        status=_clean_text(body.status),
        note=_clean_text(body.note),
        created_by_user_id=current_user.id,
    )
    db.add(row)
    db.commit()
    company = (
        db.query(SalesCompany)
        .options(
            joinedload(SalesCompany.assigned_manager),
            joinedload(SalesCompany.brought_by_manager),
            joinedload(SalesCompany.group),
            joinedload(SalesCompany.interactions),
        )
        .filter(SalesCompany.id == company_id, SalesCompany.company_slug == get_request_company())
        .first()
    )
    return _to_out(company)  # type: ignore[arg-type]


@router.delete("/{company_id}/interactions/{interaction_id}", response_model=SalesCompanyOut)
def delete_interaction(
    company_id: int,
    interaction_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_sales_access(current_user)
    company = _get_accessible_company(db, company_id, current_user)
    row = (
        db.query(SalesCompanyInteraction)
        .filter(
            SalesCompanyInteraction.id == interaction_id,
            SalesCompanyInteraction.sales_company_id == company.id,
            SalesCompanyInteraction.company_slug == get_request_company(),
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="История не найдена")
    db.delete(row)
    db.commit()
    company = (
        db.query(SalesCompany)
        .options(
            joinedload(SalesCompany.assigned_manager),
            joinedload(SalesCompany.brought_by_manager),
            joinedload(SalesCompany.group),
            joinedload(SalesCompany.interactions),
        )
        .filter(SalesCompany.id == company_id, SalesCompany.company_slug == get_request_company())
        .first()
    )
    return _to_out(company)  # type: ignore[arg-type]


@router.delete("/{company_id}")
def delete_sales_company(
    company_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_sales_access(current_user)
    q = db.query(SalesCompany).filter(
        SalesCompany.id == company_id,
        SalesCompany.company_slug == get_request_company(),
        SalesCompany.trashed_at.is_(None),
    )
    if current_user.role != "admin":
        q = q.filter(SalesCompany.assigned_manager_id == current_user.id)
    row = q.first()
    if not row:
        raise HTTPException(status_code=404, detail="Компания не найдена")
    row.trashed_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}


@router.get("/wishlist", response_model=List[SalesWishlistOut])
def list_sales_wishlist(
    scope: str = Query("mine", pattern="^(all|mine)$"),
    include_activated: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_sales_access(current_user)
    q = (
        db.query(SalesWishlistItem)
        .options(
            joinedload(SalesWishlistItem.assigned_manager),
            joinedload(SalesWishlistItem.created_by_user),
        )
        .filter(SalesWishlistItem.company_slug == get_request_company())
    )
    if not include_activated:
        q = q.filter(SalesWishlistItem.activated_company_id.is_(None))
    if current_user.role != "admin" or scope != "all":
        q = q.filter(
            (SalesWishlistItem.assigned_manager_id == current_user.id)
            | (SalesWishlistItem.created_by_user_id == current_user.id)
        )
    rows = q.order_by(SalesWishlistItem.id.desc()).all()
    return [_to_wishlist_out(r) for r in rows]


@router.post("/wishlist", response_model=SalesWishlistOut)
def create_sales_wishlist(
    body: SalesWishlistIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_sales_access(current_user)
    assigned_manager_id = (
        _validate_manager(db, body.assigned_manager_id)
        if current_user.role == "admin"
        else int(current_user.id)
    )
    row = SalesWishlistItem(
        company_slug=get_request_company(),
        company_name=body.company_name.strip(),
        potential_entry=_clean_text(body.potential_entry),
        reason=_clean_text(body.reason),
        comment=_clean_text(body.comment),
        offer=_clean_text(body.offer),
        assigned_manager_id=assigned_manager_id,
        created_by_user_id=current_user.id,
    )
    db.add(row)
    db.commit()
    row = (
        db.query(SalesWishlistItem)
        .options(joinedload(SalesWishlistItem.assigned_manager), joinedload(SalesWishlistItem.created_by_user))
        .filter(SalesWishlistItem.id == row.id, SalesWishlistItem.company_slug == get_request_company())
        .first()
    )
    return _to_wishlist_out(row)  # type: ignore[arg-type]


@router.put("/wishlist/{item_id}", response_model=SalesWishlistOut)
def update_sales_wishlist(
    item_id: int,
    body: SalesWishlistIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_sales_access(current_user)
    q = db.query(SalesWishlistItem).filter(
        SalesWishlistItem.id == item_id,
        SalesWishlistItem.company_slug == get_request_company(),
    )
    if current_user.role != "admin":
        q = q.filter(
            (SalesWishlistItem.assigned_manager_id == current_user.id)
            | (SalesWishlistItem.created_by_user_id == current_user.id)
        )
    row = q.first()
    if not row:
        raise HTTPException(status_code=404, detail="Запись wishlist не найдена")
    if row.activated_company_id is not None:
        raise HTTPException(status_code=400, detail="Эта запись уже перенесена в активные компании")
    row.company_name = body.company_name.strip()
    row.potential_entry = _clean_text(body.potential_entry)
    row.reason = _clean_text(body.reason)
    row.comment = _clean_text(body.comment)
    row.offer = _clean_text(body.offer)
    if current_user.role == "admin":
        row.assigned_manager_id = _validate_manager(db, body.assigned_manager_id)
    db.commit()
    row = (
        db.query(SalesWishlistItem)
        .options(joinedload(SalesWishlistItem.assigned_manager), joinedload(SalesWishlistItem.created_by_user))
        .filter(SalesWishlistItem.id == item_id, SalesWishlistItem.company_slug == get_request_company())
        .first()
    )
    return _to_wishlist_out(row)  # type: ignore[arg-type]


@router.delete("/wishlist/{item_id}")
def delete_sales_wishlist(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_sales_access(current_user)
    q = db.query(SalesWishlistItem).filter(
        SalesWishlistItem.id == item_id,
        SalesWishlistItem.company_slug == get_request_company(),
    )
    if current_user.role != "admin":
        q = q.filter(
            (SalesWishlistItem.assigned_manager_id == current_user.id)
            | (SalesWishlistItem.created_by_user_id == current_user.id)
        )
    row = q.first()
    if not row:
        raise HTTPException(status_code=404, detail="Запись wishlist не найдена")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/wishlist/{item_id}/activate", response_model=SalesCompanyOut)
def activate_sales_wishlist(
    item_id: int,
    body: SalesWishlistActivateIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_sales_access(current_user)
    q = db.query(SalesWishlistItem).filter(
        SalesWishlistItem.id == item_id,
        SalesWishlistItem.company_slug == get_request_company(),
    )
    if current_user.role != "admin":
        q = q.filter(
            (SalesWishlistItem.assigned_manager_id == current_user.id)
            | (SalesWishlistItem.created_by_user_id == current_user.id)
        )
    item = q.first()
    if not item:
        raise HTTPException(status_code=404, detail="Запись wishlist не найдена")
    if item.activated_company_id is not None:
        raise HTTPException(status_code=400, detail="Эта запись уже перенесена в активные компании")

    manager_id = (
        _validate_manager(db, body.assigned_manager_id if body.assigned_manager_id is not None else item.assigned_manager_id)
        if current_user.role == "admin"
        else int(current_user.id)
    )

    wishlist_parts = [
        f"Wishlist: возможный выход — {item.potential_entry}" if _clean_text(item.potential_entry) else None,
        f"Wishlist: причина — {item.reason}" if _clean_text(item.reason) else None,
        f"Wishlist: что предложить — {item.offer}" if _clean_text(item.offer) else None,
        f"Wishlist: комментарий — {item.comment}" if _clean_text(item.comment) else None,
        _clean_text(body.comment),
    ]
    merged_comment = "\n".join([p for p in wishlist_parts if p])
    company = SalesCompany(
        company_slug=get_request_company(),
        company_name=item.company_name,
        status=_clean_text(body.status) or "Новый",
        comment=(merged_comment or None),
        assigned_manager_id=manager_id,
        brought_by_manager_id=manager_id,
        position=_clean_text(body.position),
        contact_name=_clean_text(body.contact_name),
        phone=_clean_text(body.phone),
        email=_clean_text(body.email),
        contact=_clean_text(body.contact),
        lpr_name=_clean_text(body.lpr_name),
        lpr_role=_clean_text(body.lpr_role),
        lvr_name=_clean_text(body.lvr_name),
        lvr_role=_clean_text(body.lvr_role),
        created_by_user_id=current_user.id,
    )
    db.add(company)
    db.flush()
    item.activated_company_id = company.id
    item.activated_at = datetime.now(timezone.utc)
    if item.assigned_manager_id is None:
        item.assigned_manager_id = manager_id
    db.commit()
    row = (
        db.query(SalesCompany)
        .options(
            joinedload(SalesCompany.assigned_manager),
            joinedload(SalesCompany.brought_by_manager),
            joinedload(SalesCompany.group),
            joinedload(SalesCompany.interactions),
        )
        .filter(SalesCompany.id == company.id, SalesCompany.company_slug == get_request_company())
        .first()
    )
    return _to_out(row)  # type: ignore[arg-type]
