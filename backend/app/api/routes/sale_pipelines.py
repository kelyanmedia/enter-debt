"""CRM: Воронки продаж — пайплайны, этапы, сделки."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone, date
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.db.database import get_db, get_request_company
from app.core.security import get_current_user
from app.models.sale_deal_task import SaleDealTask
from app.models.sale_pipeline import SaleDeal, SaleDealComment, SalePipeline, SalePipelineStage
from app.models.user import User

router = APIRouter(prefix="/api/sales", tags=["sales-crm"])

from app.services.sales_access import (
    assert_deal_access,
    assert_manager_filter,
    filter_deals,
    get_mop_user_ids,
    is_sales_rop,
    normalize_deal_scope,
    require_crm_manage,
    require_crm_pipeline,
    require_sales_companies,
)

from app.services.client_geo import normalize_client_geo
from app.services.deal_catalog import (
    DEAL_SERVICES,
    DEAL_TAG_PRESETS,
    normalize_deal_tags,
    normalize_service_type,
    service_label,
)

TASK_TYPE_LABELS = {
    "call": "Связаться",
    "meeting": "Встреча",
    "email": "Email",
    "other": "Задача",
}


def _require_sales(current_user: User = Depends(get_current_user)) -> User:
    return require_sales_companies(current_user)


def _require_crm(current_user: User = Depends(get_current_user)) -> User:
    return require_crm_pipeline(current_user)


def _require_admin_or_mop(current_user: User = Depends(get_current_user)) -> User:
    return require_crm_manage(current_user)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class PipelineIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)


class PipelineOut(BaseModel):
    id: int
    name: str
    sort_order: int
    stage_count: int = 0
    deal_count: int = 0

    model_config = {"from_attributes": True}


class StageIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    color: Optional[str] = Field(None, max_length=20)
    sort_order: Optional[int] = None
    is_closed_won: bool = False
    is_closed_lost: bool = False


class StageOut(BaseModel):
    id: int
    name: str
    color: Optional[str]
    sort_order: int
    is_closed_won: bool
    is_closed_lost: bool

    model_config = {"from_attributes": True}


class DealIn(BaseModel):
    pipeline_id: int
    stage_id: Optional[int] = None
    title: str = Field(..., min_length=1, max_length=300)
    contact_name: Optional[str] = Field(None, max_length=220)
    company_name: Optional[str] = Field(None, max_length=300)
    phone: Optional[str] = Field(None, max_length=80)
    email: Optional[str] = Field(None, max_length=220)
    source: Optional[str] = Field(None, max_length=120)
    client_geo: Optional[str] = Field(default="UZ", max_length=8)
    service_type: Optional[str] = Field(default="seo", max_length=40)
    short_note: Optional[str] = None
    budget: Optional[Decimal] = None
    currency: str = Field(default="USD", max_length=3)
    notes: Optional[str] = None
    tags: Optional[List[str]] = None
    assigned_user_id: Optional[int] = None
    sales_company_id: Optional[int] = None


class DealUpdate(BaseModel):
    stage_id: Optional[int] = None
    title: Optional[str] = Field(None, min_length=1, max_length=300)
    contact_name: Optional[str] = Field(None, max_length=220)
    company_name: Optional[str] = Field(None, max_length=300)
    phone: Optional[str] = Field(None, max_length=80)
    email: Optional[str] = Field(None, max_length=220)
    source: Optional[str] = Field(None, max_length=120)
    client_geo: Optional[str] = Field(None, max_length=8)
    service_type: Optional[str] = Field(None, max_length=40)
    short_note: Optional[str] = None
    budget: Optional[Decimal] = None
    currency: Optional[str] = Field(None, max_length=3)
    notes: Optional[str] = None
    tags: Optional[List[str]] = None
    assigned_user_id: Optional[int] = None
    sort_order: Optional[int] = None


class DealCommentIn(BaseModel):
    body: str = Field(..., min_length=1)


class DealCommentOut(BaseModel):
    id: int
    body: str
    kind: str
    meta_json: Optional[dict] = None
    created_by_user_id: Optional[int]
    created_by_user_name: Optional[str]
    created_at: str


class DealOut(BaseModel):
    id: int
    pipeline_id: int
    stage_id: Optional[int]
    stage_name: Optional[str] = None
    title: str
    contact_name: Optional[str]
    company_name: Optional[str]
    phone: Optional[str] = None
    email: Optional[str] = None
    source: Optional[str] = None
    client_geo: Optional[str] = None
    service_type: str = "seo"
    service_label: Optional[str] = None
    short_note: Optional[str] = None
    budget: Optional[Decimal]
    currency: str
    notes: Optional[str]
    tags: List[str]
    assigned_user_id: Optional[int]
    assigned_user_name: Optional[str]
    created_by_user_id: Optional[int]
    sales_company_id: Optional[int]
    sort_order: int
    created_at: str
    updated_at: Optional[str]
    closed_at: Optional[str]
    payment_id: Optional[int] = None
    commission_id: Optional[int] = None
    next_task: Optional[DealNextTaskOut] = None

    model_config = {"from_attributes": True}


class DealDetailOut(DealOut):
    comments: List[DealCommentOut] = []
    tasks: List["DealTaskOut"] = []


class DealTaskIn(BaseModel):
    task_type: str = Field(default="call", max_length=40)
    due_at: str
    remind_minutes_before: int = Field(default=15, ge=0, le=10080)
    notes: Optional[str] = None
    assigned_user_id: Optional[int] = None


class DealTaskOut(BaseModel):
    id: int
    task_type: str
    task_type_label: str
    notes: Optional[str] = None
    due_at: str
    remind_minutes_before: int
    status: str
    assigned_user_id: Optional[int] = None
    assigned_user_name: Optional[str] = None
    created_by_user_name: Optional[str] = None
    created_at: str


class DealNextTaskOut(BaseModel):
    id: int
    task_type: str
    task_type_label: str
    due_at: str
    notes: Optional[str] = None


class DealScheduleLineIn(BaseModel):
    month: str = Field(..., min_length=7, max_length=7)
    amount: Decimal = Field(..., gt=0)
    due_date: Optional[date] = None
    description: Optional[str] = None


class DealCloseWonIn(BaseModel):
    stage_id: int
    project_category: str = Field(..., min_length=1, max_length=20)
    project_type: Optional[str] = Field(None, pattern="^(site|seo|ppc)$")
    payment_type: str = Field(default="recurring", pattern="^(recurring|one_time)$")
    description: str = Field(..., min_length=1, max_length=300)
    amount: Decimal = Field(..., gt=0)
    contract_months: Optional[int] = Field(None, ge=1, le=120)
    day_of_month: Optional[int] = Field(None, ge=1, le=28)
    contract_url: Optional[str] = Field(None, max_length=500)
    production_cost: Decimal = Field(default=Decimal(0), ge=0)
    manager_percent: Optional[Decimal] = Field(None, ge=1, le=20)
    schedule: List[DealScheduleLineIn] = Field(..., min_length=1)
    first_payment_received: bool = False
    received_amount: Optional[Decimal] = Field(None, ge=0)
    received_amount_on: Optional[date] = None
    received_payment_method: Optional[str] = Field(default="transfer", max_length=20)


class DealCloseWonOut(DealOut):
    payment_id: int
    commission_id: int


class StageWithDeals(StageOut):
    deals: List[DealOut] = []


class PipelineDetail(PipelineOut):
    stages: List[StageWithDeals] = []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_dt(value: str) -> datetime:
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Некорректная дата") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _task_out(t: SaleDealTask) -> DealTaskOut:
    return DealTaskOut(
        id=t.id,
        task_type=t.task_type,
        task_type_label=TASK_TYPE_LABELS.get(t.task_type, "Задача"),
        notes=t.notes,
        due_at=_fmt_dt(t.due_at) or "",
        remind_minutes_before=t.remind_minutes_before or 15,
        status=t.status,
        assigned_user_id=t.assigned_user_id,
        assigned_user_name=t.assigned_user.name if t.assigned_user else None,
        created_by_user_name=t.created_by_user.name if t.created_by_user else None,
        created_at=_fmt_dt(t.created_at) or "",
    )


def _fmt_dt(dt: datetime | None) -> Optional[str]:
    if dt is None:
        return None
    return dt.isoformat()


def _comment_out(c: SaleDealComment) -> DealCommentOut:
    meta = None
    if c.meta_json:
        try:
            meta = json.loads(c.meta_json)
        except Exception:
            meta = None
    author = c.created_by_user.name if c.created_by_user else None
    return DealCommentOut(
        id=c.id,
        body=c.body,
        kind=c.kind or "comment",
        meta_json=meta,
        created_by_user_id=c.created_by_user_id,
        created_by_user_name=author,
        created_at=_fmt_dt(c.created_at) or "",
    )


def _next_pending_task(d: SaleDeal) -> Optional[DealNextTaskOut]:
    pending = [t for t in (d.tasks or []) if t.status == "pending"]
    if not pending:
        return None
    t = min(pending, key=lambda x: x.due_at)
    return DealNextTaskOut(
        id=t.id,
        task_type=t.task_type,
        task_type_label=TASK_TYPE_LABELS.get(t.task_type, "Задача"),
        due_at=_fmt_dt(t.due_at) or "",
        notes=t.notes,
    )


def _deal_out(d: SaleDeal) -> DealOut:
    tags: List[str] = []
    if d.tags:
        try:
            tags = json.loads(d.tags)
        except Exception:
            tags = []
    assigned_name = None
    if d.assigned_user:
        assigned_name = d.assigned_user.name
    stage_name = d.stage.name if d.stage else None
    return DealOut(
        id=d.id,
        pipeline_id=d.pipeline_id,
        stage_id=d.stage_id,
        stage_name=stage_name,
        title=d.title,
        contact_name=d.contact_name,
        company_name=d.company_name,
        phone=d.phone,
        email=d.email,
        source=d.source,
        client_geo=d.client_geo or "UZ",
        service_type=normalize_service_type(d.service_type),
        service_label=service_label(d.service_type),
        short_note=d.short_note,
        budget=d.budget,
        currency=d.currency or "USD",
        notes=d.notes,
        tags=tags,
        assigned_user_id=d.assigned_user_id,
        assigned_user_name=assigned_name,
        created_by_user_id=d.created_by_user_id,
        sales_company_id=d.sales_company_id,
        sort_order=d.sort_order,
        created_at=_fmt_dt(d.created_at) or "",
        updated_at=_fmt_dt(d.updated_at),
        closed_at=_fmt_dt(d.closed_at),
        payment_id=d.payment_id,
        commission_id=d.commission_id,
        next_task=_next_pending_task(d),
    )


def _deal_detail_out(d: SaleDeal) -> DealDetailOut:
    base = _deal_out(d)
    comments = [_comment_out(c) for c in (d.comments or [])]
    tasks = [_task_out(t) for t in (d.tasks or []) if t.status == "pending"]
    return DealDetailOut(**base.model_dump(), comments=comments, tasks=tasks)


def _log_stage_change(
    db: Session,
    deal: SaleDeal,
    user: User,
    old_stage_name: Optional[str],
    new_stage_name: Optional[str],
) -> None:
    if old_stage_name == new_stage_name:
        return
    db.add(
        SaleDealComment(
            company_slug=get_request_company(),
            deal_id=deal.id,
            body=f"Новый этап: {new_stage_name or '—'}",
            kind="stage_change",
            meta_json=json.dumps({"from": old_stage_name, "to": new_stage_name}),
            created_by_user_id=user.id,
        )
    )


def _stage_with_deals(s: SalePipelineStage, deals: list[SaleDeal] | None = None) -> StageWithDeals:
    source = deals if deals is not None else (s.deals or [])
    return StageWithDeals(
        id=s.id,
        name=s.name,
        color=s.color,
        sort_order=s.sort_order,
        is_closed_won=s.is_closed_won,
        is_closed_lost=s.is_closed_lost,
        deals=[_deal_out(d) for d in source],
    )


# ---------------------------------------------------------------------------
# Pipelines CRUD
# ---------------------------------------------------------------------------

@router.get("/pipelines", response_model=List[PipelineOut])
def list_pipelines(
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_crm),
):
    rows = (
        db.query(SalePipeline)
        .filter(SalePipeline.company_slug == get_request_company())
        .order_by(SalePipeline.sort_order, SalePipeline.id)
        .all()
    )
    out = []
    for p in rows:
        stage_count = len(p.stages or [])
        deal_count = sum(len(s.deals or []) for s in (p.stages or []))
        out.append(PipelineOut(
            id=p.id,
            name=p.name,
            sort_order=p.sort_order,
            stage_count=stage_count,
            deal_count=deal_count,
        ))
    return out


@router.post("/pipelines", response_model=PipelineDetail)
def create_pipeline(
    body: PipelineIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_admin_or_mop),
):
    existing = (
        db.query(SalePipeline)
        .filter(SalePipeline.company_slug == get_request_company())
        .count()
    )
    p = SalePipeline(
        company_slug=get_request_company(),
        name=body.name.strip(),
        sort_order=existing,
        created_by_user_id=current_user.id,
    )
    db.add(p)
    db.flush()

    # Стандартные этапы — как в amoCRM-воронке (скрин референс)
    default_stages = [
        ("ПЕРВИЧНЫЙ КОНТАКТ", "#b8c0cc", False, False),
        ("В РАБОТЕ", "#6ba3d6", False, False),
        ("ОТПРАВКА КП", "#4a90d9", False, False),
        ("ОЖИДАНИЕ", "#3a7bc8", False, False),
        ("НЕДОСТУПЕН", "#e74c3c", False, True),
        ("НЕ ИНТЕРЕСУЕТ", "#ff7f6e", False, True),
        ("ВЫБРАЛИ ДРУГИХ", "#ff7f6e", False, True),
        ("ВЫСОКАЯ ЦЕНА", "#ff7f6e", False, True),
        ("НЕЦЕЛЕВОЙ", "#ff7f6e", False, True),
        ("НЕ НАШ ПРОФИЛЬ РАБОТЫ", "#ff7f6e", False, True),
        ("НЕ ВЫШЛИ НА ЛПР", "#ff7f6e", False, True),
    ]
    for i, (name, color, won, lost) in enumerate(default_stages):
        st = SalePipelineStage(
            company_slug=get_request_company(),
            pipeline_id=p.id,
            name=name,
            color=color,
            sort_order=i,
            is_closed_won=won,
            is_closed_lost=lost,
        )
        db.add(st)

    db.commit()
    p = (
        db.query(SalePipeline)
        .options(
            joinedload(SalePipeline.stages).joinedload(SalePipelineStage.deals).joinedload(SaleDeal.assigned_user)
        )
        .filter(SalePipeline.id == p.id)
        .first()
    )
    return PipelineDetail(
        id=p.id,
        name=p.name,
        sort_order=p.sort_order,
        stage_count=len(p.stages or []),
        deal_count=0,
        stages=[_stage_with_deals(s) for s in (p.stages or [])],
    )


@router.get("/pipelines/{pipeline_id}", response_model=PipelineDetail)
def get_pipeline(
    pipeline_id: int,
    scope: Optional[str] = None,
    assigned_user_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_crm),
):
    p = (
        db.query(SalePipeline)
        .options(
            joinedload(SalePipeline.stages).joinedload(SalePipelineStage.deals).joinedload(SaleDeal.assigned_user),
            joinedload(SalePipeline.stages).joinedload(SalePipelineStage.deals).joinedload(SaleDeal.tasks),
        )
        .filter(
            SalePipeline.id == pipeline_id,
            SalePipeline.company_slug == get_request_company(),
        )
        .first()
    )
    if not p:
        raise HTTPException(status_code=404, detail="Воронка не найдена")
    deal_scope = normalize_deal_scope(scope, current_user)
    mop_ids = get_mop_user_ids(db, get_request_company())
    assert_manager_filter(current_user, mop_ids, assigned_user_id, deal_scope)
    stages = []
    deal_count = 0
    for s in (p.stages or []):
        visible = filter_deals(list(s.deals or []), current_user, mop_ids, deal_scope)
        if assigned_user_id is not None:
            visible = [d for d in visible if d.assigned_user_id == assigned_user_id]
        deal_count += len(visible)
        stages.append(_stage_with_deals(s, visible))
    return PipelineDetail(
        id=p.id,
        name=p.name,
        sort_order=p.sort_order,
        stage_count=len(stages),
        deal_count=deal_count,
        stages=stages,
    )


@router.patch("/pipelines/{pipeline_id}", response_model=PipelineOut)
def rename_pipeline(
    pipeline_id: int,
    body: PipelineIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_admin_or_mop),
):
    p = (
        db.query(SalePipeline)
        .filter(
            SalePipeline.id == pipeline_id,
            SalePipeline.company_slug == get_request_company(),
        )
        .first()
    )
    if not p:
        raise HTTPException(status_code=404, detail="Воронка не найдена")
    p.name = body.name.strip()
    db.commit()
    return PipelineOut(id=p.id, name=p.name, sort_order=p.sort_order)


@router.delete("/pipelines/{pipeline_id}")
def delete_pipeline(
    pipeline_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_admin_or_mop),
):
    p = (
        db.query(SalePipeline)
        .filter(
            SalePipeline.id == pipeline_id,
            SalePipeline.company_slug == get_request_company(),
        )
        .first()
    )
    if not p:
        raise HTTPException(status_code=404, detail="Воронка не найдена")
    db.delete(p)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Stages CRUD
# ---------------------------------------------------------------------------

@router.post("/pipelines/{pipeline_id}/stages", response_model=StageOut)
def add_stage(
    pipeline_id: int,
    body: StageIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_admin_or_mop),
):
    p = (
        db.query(SalePipeline)
        .filter(
            SalePipeline.id == pipeline_id,
            SalePipeline.company_slug == get_request_company(),
        )
        .first()
    )
    if not p:
        raise HTTPException(status_code=404, detail="Воронка не найдена")
    max_order = (
        db.query(func.max(SalePipelineStage.sort_order))
        .filter(SalePipelineStage.pipeline_id == pipeline_id)
        .scalar()
    ) or 0
    s = SalePipelineStage(
        company_slug=get_request_company(),
        pipeline_id=pipeline_id,
        name=body.name.strip(),
        color=body.color,
        sort_order=body.sort_order if body.sort_order is not None else max_order + 1,
        is_closed_won=body.is_closed_won,
        is_closed_lost=body.is_closed_lost,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


@router.patch("/pipeline-stages/{stage_id}", response_model=StageOut)
def update_stage(
    stage_id: int,
    body: StageIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_admin_or_mop),
):
    s = (
        db.query(SalePipelineStage)
        .filter(
            SalePipelineStage.id == stage_id,
            SalePipelineStage.company_slug == get_request_company(),
        )
        .first()
    )
    if not s:
        raise HTTPException(status_code=404, detail="Этап не найден")
    s.name = body.name.strip()
    if body.color is not None:
        s.color = body.color
    if body.sort_order is not None:
        s.sort_order = body.sort_order
    s.is_closed_won = body.is_closed_won
    s.is_closed_lost = body.is_closed_lost
    db.commit()
    db.refresh(s)
    return s


@router.delete("/pipeline-stages/{stage_id}")
def delete_stage(
    stage_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_admin_or_mop),
):
    s = (
        db.query(SalePipelineStage)
        .filter(
            SalePipelineStage.id == stage_id,
            SalePipelineStage.company_slug == get_request_company(),
        )
        .first()
    )
    if not s:
        raise HTTPException(status_code=404, detail="Этап не найден")
    db.query(SaleDeal).filter(SaleDeal.stage_id == stage_id).update({"stage_id": None})
    db.delete(s)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Deals CRUD
# ---------------------------------------------------------------------------

@router.get("/deals/catalog")
def deal_catalog(current_user: User = Depends(_require_crm)):
    return {"services": DEAL_SERVICES, "tags": DEAL_TAG_PRESETS}


@router.post("/deals", response_model=DealOut)
def create_deal(
    body: DealIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_crm),
):
    p = (
        db.query(SalePipeline)
        .filter(
            SalePipeline.id == body.pipeline_id,
            SalePipeline.company_slug == get_request_company(),
        )
        .first()
    )
    if not p:
        raise HTTPException(status_code=404, detail="Воронка не найдена")

    stage_id = body.stage_id
    if stage_id is not None:
        st = (
            db.query(SalePipelineStage)
            .filter(
                SalePipelineStage.id == stage_id,
                SalePipelineStage.pipeline_id == body.pipeline_id,
            )
            .first()
        )
        if not st:
            raise HTTPException(status_code=404, detail="Этап не найден")
    else:
        first_stage = (
            db.query(SalePipelineStage)
            .filter(SalePipelineStage.pipeline_id == body.pipeline_id)
            .order_by(SalePipelineStage.sort_order)
            .first()
        )
        stage_id = first_stage.id if first_stage else None

    max_order = (
        db.query(func.max(SaleDeal.sort_order))
        .filter(SaleDeal.stage_id == stage_id)
        .scalar()
    ) or 0

    tags_json = json.dumps(normalize_deal_tags(body.tags))
    d = SaleDeal(
        company_slug=get_request_company(),
        pipeline_id=body.pipeline_id,
        stage_id=stage_id,
        title=body.title.strip(),
        contact_name=(body.contact_name or "").strip() or None,
        company_name=(body.company_name or "").strip() or None,
        phone=(body.phone or "").strip() or None,
        email=(body.email or "").strip() or None,
        source=(body.source or "").strip() or None,
        client_geo=normalize_client_geo(body.client_geo),
        service_type=normalize_service_type(body.service_type),
        short_note=(body.short_note or "").strip() or None,
        budget=body.budget,
        currency=(body.currency or "USD").upper(),
        notes=(body.notes or "").strip() or None,
        tags=tags_json,
        assigned_user_id=body.assigned_user_id or current_user.id,
        sales_company_id=body.sales_company_id,
        created_by_user_id=current_user.id,
        sort_order=max_order + 1,
    )
    db.add(d)
    db.flush()
    created_stage = (
        db.query(SalePipelineStage).filter(SalePipelineStage.id == stage_id).first()
        if stage_id else None
    )
    db.add(
        SaleDealComment(
            company_slug=get_request_company(),
            deal_id=d.id,
            body="Сделка создана",
            kind="system",
            created_by_user_id=current_user.id,
        )
    )
    if created_stage:
        db.add(
            SaleDealComment(
                company_slug=get_request_company(),
                deal_id=d.id,
                body=f"Этап: {created_stage.name}",
                kind="stage_change",
                meta_json=json.dumps({"to": created_stage.name}),
                created_by_user_id=current_user.id,
            )
        )
    db.commit()
    d = (
        db.query(SaleDeal)
        .options(joinedload(SaleDeal.assigned_user))
        .filter(SaleDeal.id == d.id)
        .first()
    )
    return _deal_out(d)


@router.patch("/deals/{deal_id}", response_model=DealOut)
def update_deal(
    deal_id: int,
    body: DealUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_crm),
):
    d = (
        db.query(SaleDeal)
        .options(joinedload(SaleDeal.assigned_user))
        .filter(
            SaleDeal.id == deal_id,
            SaleDeal.company_slug == get_request_company(),
        )
        .first()
    )
    if not d:
        raise HTTPException(status_code=404, detail="Сделка не найдена")
    assert_deal_access(db, current_user, d)

    old_stage_name = None
    if d.stage_id:
        old_st = db.query(SalePipelineStage).filter(SalePipelineStage.id == d.stage_id).first()
        old_stage_name = old_st.name if old_st else None

    dump = body.model_dump(exclude_unset=True)
    new_stage_name = old_stage_name
    if "stage_id" in dump:
        new_stage = dump["stage_id"]
        if new_stage is not None:
            st = (
                db.query(SalePipelineStage)
                .filter(
                    SalePipelineStage.id == new_stage,
                    SalePipelineStage.pipeline_id == d.pipeline_id,
                )
                .first()
            )
            if not st:
                raise HTTPException(status_code=404, detail="Этап не найден")
            if st.is_closed_won and not d.payment_id:
                raise HTTPException(
                    status_code=400,
                    detail="Для закрытия сделки заполните договор и график оплат (кнопка «Закрыть сделку»)",
                )
            new_stage_name = st.name
            if st.is_closed_won or st.is_closed_lost:
                d.closed_at = datetime.now(timezone.utc)
            else:
                d.closed_at = None
        else:
            new_stage_name = None
        d.stage_id = new_stage
        _log_stage_change(db, d, current_user, old_stage_name, new_stage_name)

    if "title" in dump:
        d.title = dump["title"].strip()
    if "contact_name" in dump:
        d.contact_name = (dump["contact_name"] or "").strip() or None
    if "company_name" in dump:
        d.company_name = (dump["company_name"] or "").strip() or None
    if "phone" in dump:
        d.phone = (dump["phone"] or "").strip() or None
    if "email" in dump:
        d.email = (dump["email"] or "").strip() or None
    if "source" in dump:
        d.source = (dump["source"] or "").strip() or None
    if "client_geo" in dump:
        d.client_geo = normalize_client_geo(dump["client_geo"])
    if "service_type" in dump and dump["service_type"]:
        d.service_type = normalize_service_type(dump["service_type"])
    if "short_note" in dump:
        d.short_note = (dump["short_note"] or "").strip() or None
    if "budget" in dump:
        d.budget = dump["budget"]
    if "currency" in dump and dump["currency"]:
        d.currency = dump["currency"].upper()
    if "notes" in dump:
        d.notes = (dump["notes"] or "").strip() or None
    if "tags" in dump:
        d.tags = json.dumps(normalize_deal_tags(dump["tags"]))
    if "assigned_user_id" in dump:
        if is_sales_rop(current_user):
            d.assigned_user_id = dump["assigned_user_id"]
    if "sort_order" in dump:
        d.sort_order = dump["sort_order"]

    db.commit()
    d = (
        db.query(SaleDeal)
        .options(joinedload(SaleDeal.assigned_user))
        .filter(SaleDeal.id == deal_id)
        .first()
    )
    return _deal_out(d)


@router.post("/deals/{deal_id}/close-won", response_model=DealCloseWonOut)
def close_deal_won_endpoint(
    deal_id: int,
    body: DealCloseWonIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_crm),
):
    """Закрыть выигранную сделку: проект в «Проекты» + комиссия МОП."""
    import traceback as _tb

    d = (
        db.query(SaleDeal)
        .options(joinedload(SaleDeal.assigned_user))
        .filter(
            SaleDeal.id == deal_id,
            SaleDeal.company_slug == get_request_company(),
        )
        .first()
    )
    if not d:
        raise HTTPException(status_code=404, detail="Сделка не найдена")
    assert_deal_access(db, current_user, d)

    from app.services.sale_deal_win import ScheduleLine, close_deal_won

    schedule = [
        ScheduleLine(
            month=line.month,
            amount=line.amount,
            due_date=line.due_date,
            description=line.description,
        )
        for line in body.schedule
    ]
    try:
        pay, commission = close_deal_won(
            db,
            d,
            current_user,
            stage_id=body.stage_id,
            project_category=body.project_category,
            project_type=body.project_type,
            payment_type=body.payment_type,
            description=body.description,
            amount=body.amount,
            contract_months=body.contract_months,
            day_of_month=body.day_of_month,
            contract_url=body.contract_url,
            production_cost=body.production_cost,
            manager_percent=body.manager_percent,
            schedule=schedule,
            first_payment_received=body.first_payment_received,
            received_amount=body.received_amount,
            received_amount_on=body.received_amount_on,
            received_payment_method=body.received_payment_method,
        )
        # Extract scalar values before commit (avoids lazy-load after expiry)
        db.flush()
        pay_id = int(pay.id)
        comm_id = int(commission.id)
        partner_id = int(pay.partner_id)
        pay_desc = str(pay.description or "")
        db.commit()
    except HTTPException:
        raise
    except Exception as _e:
        import logging as _log
        _log.getLogger("close_won").error("close_deal_won failed: %s\n%s", _e, _tb.format_exc())
        raise HTTPException(status_code=500, detail=f"close_deal_won error: {_e}")

    try:
        from app.services.feed_events import emit_payment_created
        emit_payment_created(pay_id, partner_id, pay_desc)
    except Exception:
        pass

    try:
        d = (
            db.query(SaleDeal)
            .options(joinedload(SaleDeal.assigned_user))
            .filter(SaleDeal.id == deal_id)
            .first()
        )
        base = _deal_out(d)
        base_data = base.model_dump()
        base_data["payment_id"] = pay_id
        base_data["commission_id"] = comm_id
        return DealCloseWonOut(**base_data)
    except Exception as _e:
        import logging as _log
        _log.getLogger("close_won").error("response build failed: %s\n%s", _e, _tb.format_exc())
        raise HTTPException(status_code=500, detail=f"response build error: {_e}")


@router.get("/deals/{deal_id}", response_model=DealDetailOut)
def get_deal(
    deal_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_crm),
):
    d = (
        db.query(SaleDeal)
        .options(
            joinedload(SaleDeal.assigned_user),
            joinedload(SaleDeal.stage),
            joinedload(SaleDeal.comments).joinedload(SaleDealComment.created_by_user),
            joinedload(SaleDeal.tasks).joinedload(SaleDealTask.assigned_user),
            joinedload(SaleDeal.tasks).joinedload(SaleDealTask.created_by_user),
        )
        .filter(
            SaleDeal.id == deal_id,
            SaleDeal.company_slug == get_request_company(),
        )
        .first()
    )
    if not d:
        raise HTTPException(status_code=404, detail="Сделка не найдена")
    assert_deal_access(db, current_user, d)
    return _deal_detail_out(d)


@router.post("/deals/{deal_id}/comments", response_model=DealCommentOut)
def add_deal_comment(
    deal_id: int,
    body: DealCommentIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_crm),
):
    d = (
        db.query(SaleDeal)
        .filter(
            SaleDeal.id == deal_id,
            SaleDeal.company_slug == get_request_company(),
        )
        .first()
    )
    if not d:
        raise HTTPException(status_code=404, detail="Сделка не найдена")
    assert_deal_access(db, current_user, d)
    c = SaleDealComment(
        company_slug=get_request_company(),
        deal_id=deal_id,
        body=body.body.strip(),
        kind="comment",
        created_by_user_id=current_user.id,
    )
    db.add(c)
    db.commit()
    c = (
        db.query(SaleDealComment)
        .options(joinedload(SaleDealComment.created_by_user))
        .filter(SaleDealComment.id == c.id)
        .first()
    )
    return _comment_out(c)


@router.post("/deals/{deal_id}/tasks", response_model=DealTaskOut, status_code=201)
def create_deal_task(
    deal_id: int,
    body: DealTaskIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_crm),
):
    d = (
        db.query(SaleDeal)
        .filter(SaleDeal.id == deal_id, SaleDeal.company_slug == get_request_company())
        .first()
    )
    if not d:
        raise HTTPException(status_code=404, detail="Сделка не найдена")
    assert_deal_access(db, current_user, d)
    if body.task_type not in TASK_TYPE_LABELS:
        raise HTTPException(status_code=400, detail="Неизвестный тип задачи")

    due_at = _parse_dt(body.due_at)
    if due_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Дедлайн должен быть в будущем")

    assignee = body.assigned_user_id or d.assigned_user_id or current_user.id
    label = TASK_TYPE_LABELS[body.task_type]
    due_fmt = due_at.astimezone(timezone.utc).strftime("%d.%m.%Y %H:%M")

    task = SaleDealTask(
        company_slug=get_request_company(),
        deal_id=deal_id,
        task_type=body.task_type,
        notes=(body.notes or "").strip() or None,
        due_at=due_at,
        remind_minutes_before=body.remind_minutes_before,
        assigned_user_id=assignee,
        created_by_user_id=current_user.id,
        status="pending",
    )
    db.add(task)
    db.flush()

    db.add(
        SaleDealComment(
            company_slug=get_request_company(),
            deal_id=deal_id,
            body=f"Задача: {label} · {due_fmt}" + (f" — {task.notes}" if task.notes else ""),
            kind="task",
            meta_json=json.dumps({
                "task_id": task.id,
                "task_type": body.task_type,
                "due_at": due_at.isoformat(),
                "remind_minutes_before": body.remind_minutes_before,
            }),
            created_by_user_id=current_user.id,
        )
    )
    db.commit()
    task = (
        db.query(SaleDealTask)
        .options(joinedload(SaleDealTask.assigned_user), joinedload(SaleDealTask.created_by_user))
        .filter(SaleDealTask.id == task.id)
        .first()
    )
    return _task_out(task)


@router.patch("/deals/{deal_id}/tasks/{task_id}/complete")
def complete_deal_task(
    deal_id: int,
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_crm),
):
    task = (
        db.query(SaleDealTask)
        .filter(
            SaleDealTask.id == task_id,
            SaleDealTask.deal_id == deal_id,
            SaleDealTask.company_slug == get_request_company(),
        )
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    task.status = "done"
    task.completed_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}


@router.delete("/deals/{deal_id}/tasks/{task_id}")
def delete_deal_task(
    deal_id: int,
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_crm),
):
    task = (
        db.query(SaleDealTask)
        .filter(
            SaleDealTask.id == task_id,
            SaleDealTask.deal_id == deal_id,
            SaleDealTask.company_slug == get_request_company(),
        )
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    task.status = "cancelled"
    db.commit()
    return {"ok": True}


@router.delete("/deals/{deal_id}")
def delete_deal(
    deal_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_crm),
):
    d = (
        db.query(SaleDeal)
        .filter(
            SaleDeal.id == deal_id,
            SaleDeal.company_slug == get_request_company(),
        )
        .first()
    )
    if not d:
        raise HTTPException(status_code=404, detail="Сделка не найдена")
    assert_deal_access(db, current_user, d)
    db.delete(d)
    db.commit()
    return {"ok": True}


@router.get("/users-list")
def get_sales_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_crm),
):
    """Список пользователей для поля «Ответственный» в сделке."""
    rows = (
        db.query(User)
        .filter(
            User.company_slug == get_request_company(),
            User.is_active == True,
            User.role.in_(["admin", "mop", "manager"]),
        )
        .order_by(User.name)
        .all()
    )
    return [{"id": u.id, "name": u.name, "role": u.role} for u in rows]
