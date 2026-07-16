"""CRM: обязательные поля сделки (автоматизации по менеджеру)."""
from __future__ import annotations

import json
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.database import get_db, get_request_company
from app.models.sale_deal_field_requirement import SaleDealFieldRequirement
from app.models.user import User
from app.services.deal_field_requirements import (
    ALLOWED_FIELDS,
    FIELD_LABELS,
    parse_required_fields,
)
from app.services.sales_access import (
    can_edit_deal_field_automations,
    get_mop_user_ids,
    is_sales_rop,
    require_crm_pipeline,
)

router = APIRouter(prefix="/api/sales", tags=["sales-automations"])


def _require_crm(user: User = Depends(get_current_user)) -> User:
    return require_crm_pipeline(user)


def _require_manage(user: User = Depends(get_current_user)) -> User:
    require_crm_pipeline(user)
    if can_edit_deal_field_automations(user):
        return user
    raise HTTPException(status_code=403, detail="Только администратор или РОП")


def _rop_may_edit_manager(db: Session, slug: str, current_user: User, target: User) -> bool:
    """РОП правит обязательные поля обычных МОПов и свои; чужих РОП/админов — нет."""
    if current_user.role == "admin":
        return True
    if not is_sales_rop(current_user):
        return False
    if int(target.id) == int(current_user.id):
        return True
    if target.role != "mop" or is_sales_rop(target):
        return False
    mop_ids = get_mop_user_ids(db, slug)
    return int(target.id) in mop_ids


def _normalize_fields(fields: List[str]) -> List[str]:
    seen = set()
    out: List[str] = []
    for f in fields:
        if f in ALLOWED_FIELDS and f not in seen:
            seen.add(f)
            out.append(f)
    return out


class FieldRequirementOut(BaseModel):
    manager_user_id: int
    manager_name: str
    required_fields: List[str]


class FieldRequirementPut(BaseModel):
    required_fields: List[str] = Field(default_factory=list)


class FieldRequirementCatalogOut(BaseModel):
    fields: List[dict]
    managers: List[FieldRequirementOut]


@router.get("/deal-field-requirements", response_model=FieldRequirementCatalogOut)
def list_field_requirements(
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_manage),
):
    slug = get_request_company()
    mop_ids = get_mop_user_ids(db, slug)
    users = (
        db.query(User)
        .filter(
            User.company_slug == slug,
            User.is_active == True,
            User.role.in_(["mop", "manager", "admin"]),
        )
        .order_by(User.name)
        .all()
    )
    # РОП видит обычных МОПов (без других РОП) + себя
    if is_sales_rop(current_user) and current_user.role != "admin":
        users = [
            u
            for u in users
            if int(u.id) == int(current_user.id)
            or (int(u.id) in mop_ids and not is_sales_rop(u))
        ]

    rows = (
        db.query(SaleDealFieldRequirement)
        .filter(SaleDealFieldRequirement.company_slug == slug)
        .all()
    )
    by_mgr = {int(r.manager_user_id): parse_required_fields(r.required_fields) for r in rows}

    return FieldRequirementCatalogOut(
        fields=[{"key": k, "label": FIELD_LABELS[k]} for k in ALLOWED_FIELDS],
        managers=[
            FieldRequirementOut(
                manager_user_id=int(u.id),
                manager_name=u.name or f"User #{u.id}",
                required_fields=by_mgr.get(int(u.id), []),
            )
            for u in users
        ],
    )


@router.get("/deal-field-requirements/{manager_user_id}", response_model=FieldRequirementOut)
def get_field_requirement(
    manager_user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_crm),
):
    slug = get_request_company()
    # Свой набор — любому CRM; чужой — только admin/ROP
    user = (
        db.query(User)
        .filter(User.id == manager_user_id, User.company_slug == slug)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="Менеджер не найден")

    if int(manager_user_id) != int(current_user.id):
        if not can_edit_deal_field_automations(current_user):
            raise HTTPException(status_code=403, detail="Нет доступа")
        if is_sales_rop(current_user) and current_user.role != "admin":
            if not _rop_may_edit_manager(db, slug, current_user, user):
                raise HTTPException(status_code=403, detail="Нет доступа к этому менеджеру")

    row = (
        db.query(SaleDealFieldRequirement)
        .filter(
            SaleDealFieldRequirement.company_slug == slug,
            SaleDealFieldRequirement.manager_user_id == manager_user_id,
        )
        .first()
    )
    return FieldRequirementOut(
        manager_user_id=int(user.id),
        manager_name=user.name or f"User #{user.id}",
        required_fields=parse_required_fields(row.required_fields if row else None),
    )


@router.put("/deal-field-requirements/{manager_user_id}", response_model=FieldRequirementOut)
def put_field_requirement(
    manager_user_id: int,
    body: FieldRequirementPut,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_manage),
):
    slug = get_request_company()
    user = (
        db.query(User)
        .filter(User.id == manager_user_id, User.company_slug == slug, User.is_active == True)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="Менеджер не найден")

    if is_sales_rop(current_user) and current_user.role != "admin":
        if not _rop_may_edit_manager(db, slug, current_user, user):
            raise HTTPException(status_code=403, detail="Нет доступа к этому менеджеру")

    fields = _normalize_fields(body.required_fields)
    row = (
        db.query(SaleDealFieldRequirement)
        .filter(
            SaleDealFieldRequirement.company_slug == slug,
            SaleDealFieldRequirement.manager_user_id == manager_user_id,
        )
        .first()
    )
    if not row:
        row = SaleDealFieldRequirement(
            company_slug=slug,
            manager_user_id=manager_user_id,
            required_fields=json.dumps(fields, ensure_ascii=False),
        )
        db.add(row)
    else:
        row.required_fields = json.dumps(fields, ensure_ascii=False)
    db.commit()
    db.refresh(row)
    return FieldRequirementOut(
        manager_user_id=int(user.id),
        manager_name=user.name or f"User #{user.id}",
        required_fields=parse_required_fields(row.required_fields),
    )
