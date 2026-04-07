"""Настройки подписей: разделы «Все / Услуги / …» и линии проектов по company_slug."""

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_admin, require_admin_or_accountant
from app.db.database import get_db, get_request_company
from app.models.company_ui import CompanyPaymentsSegment, CompanyProjectLine, CompanyProjectsCostField
from app.models.user import User
from app.services.company_ui_defaults import (
    CANONICAL_CATEGORY_SLUGS,
    DEFAULT_PROJECTS_COST_FIELD_LABELS,
    PROJECTS_COST_FIELD_KEYS,
    SEGMENT_KEYS,
    ensure_company_ui_rows,
    ensure_projects_cost_field_rows,
)

router = APIRouter(prefix="/api/company-ui", tags=["company-ui"])


class PaymentsSegmentOut(BaseModel):
    segment_key: str
    label: str
    sort_order: int
    is_visible: bool


class ProjectLineOut(BaseModel):
    category_slug: str
    label: str
    sort_order: int
    is_visible: bool


class CompanyPaymentsUiOut(BaseModel):
    segments: List[PaymentsSegmentOut]
    lines: List[ProjectLineOut]


class PaymentsSegmentUpdate(BaseModel):
    segment_key: str
    label: str = Field(..., min_length=1, max_length=120)
    sort_order: int = 0
    is_visible: bool = True


class ProjectLineUpdate(BaseModel):
    category_slug: str
    label: str = Field(..., min_length=1, max_length=120)
    sort_order: int = 0
    is_visible: bool = True


class CompanyPaymentsUiPut(BaseModel):
    segments: List[PaymentsSegmentUpdate]
    lines: List[ProjectLineUpdate]


class ProjectsCostFieldOut(BaseModel):
    field_key: str
    label: str


class CompanyProjectsCostUiOut(BaseModel):
    fields: List[ProjectsCostFieldOut]


class ProjectsCostFieldUpdate(BaseModel):
    field_key: str
    label: str = Field(..., min_length=1, max_length=120)


class CompanyProjectsCostUiPut(BaseModel):
    fields: List[ProjectsCostFieldUpdate]


def _payments_ui_out(db: Session, company_slug: str) -> CompanyPaymentsUiOut:
    segs = (
        db.query(CompanyPaymentsSegment)
        .filter(CompanyPaymentsSegment.company_slug == company_slug)
        .order_by(CompanyPaymentsSegment.sort_order.asc(), CompanyPaymentsSegment.id.asc())
        .all()
    )
    lines = (
        db.query(CompanyProjectLine)
        .filter(CompanyProjectLine.company_slug == company_slug)
        .order_by(CompanyProjectLine.sort_order.asc(), CompanyProjectLine.id.asc())
        .all()
    )
    return CompanyPaymentsUiOut(
        segments=[
            PaymentsSegmentOut(
                segment_key=s.segment_key,
                label=s.label,
                sort_order=s.sort_order,
                is_visible=bool(s.is_visible),
            )
            for s in segs
        ],
        lines=[
            ProjectLineOut(
                category_slug=l.category_slug,
                label=l.label,
                sort_order=l.sort_order,
                is_visible=bool(l.is_visible),
            )
            for l in lines
        ],
    )


@router.get("/payments", response_model=CompanyPaymentsUiOut)
def get_payments_ui(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    slug = get_request_company()
    ensure_company_ui_rows(db, slug)
    return _payments_ui_out(db, slug)


@router.put("/payments", response_model=CompanyPaymentsUiOut)
def put_payments_ui(
    body: CompanyPaymentsUiPut,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    slug = get_request_company()

    seg_keys = {s.segment_key for s in body.segments}
    if seg_keys != set(SEGMENT_KEYS):
        raise HTTPException(
            status_code=400,
            detail=f"Нужны ровно три раздела с ключами: {', '.join(SEGMENT_KEYS)}",
        )
    for s in body.segments:
        if s.segment_key not in SEGMENT_KEYS:
            raise HTTPException(status_code=400, detail=f"Неизвестный segment_key: {s.segment_key}")

    line_slugs = {l.category_slug for l in body.lines}
    if line_slugs != set(CANONICAL_CATEGORY_SLUGS):
        raise HTTPException(
            status_code=400,
            detail="Список линий должен содержать ровно все канонические категории (нельзя добавлять или удалять slug)",
        )

    ensure_company_ui_rows(db, slug)

    for row in body.segments:
        q = (
            db.query(CompanyPaymentsSegment)
            .filter(
                CompanyPaymentsSegment.company_slug == slug,
                CompanyPaymentsSegment.segment_key == row.segment_key,
            )
            .first()
        )
        if q:
            q.label = row.label.strip()
            q.sort_order = row.sort_order
            q.is_visible = row.is_visible

    for row in body.lines:
        q = (
            db.query(CompanyProjectLine)
            .filter(
                CompanyProjectLine.company_slug == slug,
                CompanyProjectLine.category_slug == row.category_slug,
            )
            .first()
        )
        if q:
            q.label = row.label.strip()
            q.sort_order = row.sort_order
            q.is_visible = row.is_visible

    db.commit()
    return _payments_ui_out(db, slug)


@router.get("/projects-cost", response_model=CompanyProjectsCostUiOut)
def get_projects_cost_ui(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    slug = get_request_company()
    ensure_projects_cost_field_rows(db, slug)
    rows = (
        db.query(CompanyProjectsCostField)
        .filter(CompanyProjectsCostField.company_slug == slug)
        .order_by(CompanyProjectsCostField.id.asc())
        .all()
    )
    return CompanyProjectsCostUiOut(
        fields=[ProjectsCostFieldOut(field_key=r.field_key, label=r.label) for r in rows]
    )


@router.put("/projects-cost", response_model=CompanyProjectsCostUiOut)
def put_projects_cost_ui(
    body: CompanyProjectsCostUiPut,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin_or_accountant),
):
    slug = get_request_company()
    keys = {row.field_key for row in body.fields}
    if keys != set(PROJECTS_COST_FIELD_KEYS):
        raise HTTPException(
            status_code=400,
            detail=f"Нужны ровно поля: {', '.join(PROJECTS_COST_FIELD_KEYS)}",
        )

    ensure_projects_cost_field_rows(db, slug)
    for row in body.fields:
        q = (
            db.query(CompanyProjectsCostField)
            .filter(
                CompanyProjectsCostField.company_slug == slug,
                CompanyProjectsCostField.field_key == row.field_key,
            )
            .first()
        )
        if q:
            q.label = row.label.strip() or DEFAULT_PROJECTS_COST_FIELD_LABELS[row.field_key]
    db.commit()
    return get_projects_cost_ui(db, _admin)
