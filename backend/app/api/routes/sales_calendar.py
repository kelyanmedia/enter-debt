"""CRM: календарь встреч — создание, просмотр, привязка к компаниям."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.core.security import get_current_user
from app.db.database import get_db, get_request_company
from app.models.sale_meeting import SaleMeeting, SaleMeetingParticipant
from app.models.sale_pipeline import SaleDeal
from app.models.sales_company import SalesCompany
from app.models.user import User

router = APIRouter(prefix="/api/sales", tags=["sales-crm"])

from app.services.sales_access import is_sales_rop, require_crm_pipeline, get_mop_user_ids

SERVICE_TYPES = [
    {"key": "discovery", "label": "Discovery Call", "bg": "#dbeafe", "border": "#93c5fd", "accent": "#3b82f6"},
    {"key": "proposal", "label": "Proposal Review", "bg": "#e0f2fe", "border": "#7dd3fc", "accent": "#0284c7"},
    {"key": "onboarding", "label": "Onboarding", "bg": "#fce7f3", "border": "#f9a8d4", "accent": "#db2777"},
    {"key": "demo", "label": "Демо", "bg": "#ede9fe", "border": "#c4b5fd", "accent": "#7c3aed"},
    {"key": "followup", "label": "Follow-up", "bg": "#dcfce7", "border": "#86efac", "accent": "#16a34a"},
    {"key": "negotiation", "label": "Переговоры", "bg": "#ffedd5", "border": "#fdba74", "accent": "#ea580c"},
]

_SERVICE_BY_KEY = {s["key"]: s for s in SERVICE_TYPES}


def _require_sales(current_user: User = Depends(get_current_user)) -> User:
    return require_crm_pipeline(current_user)


def _service_meta(key: str) -> dict:
    return _SERVICE_BY_KEY.get(key) or _SERVICE_BY_KEY["discovery"]


def _parse_dt(value: str) -> datetime:
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Некорректная дата") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _meeting_query(db: Session, slug: str, current_user: User):
    q = (
        db.query(SaleMeeting)
        .filter(SaleMeeting.company_slug == slug)
        .options(
            joinedload(SaleMeeting.created_by_user),
            joinedload(SaleMeeting.participants).joinedload(SaleMeetingParticipant.user),
            joinedload(SaleMeeting.sales_company),
            joinedload(SaleMeeting.sale_deal),
        )
    )
    if current_user.role != "admin":
        q = q.filter(
            or_(
                SaleMeeting.created_by_user_id == current_user.id,
                SaleMeeting.participants.any(SaleMeetingParticipant.user_id == current_user.id),
            )
        )
    return q


def _serialize(m: SaleMeeting) -> dict:
    svc = _service_meta(m.service_type)
    return {
        "id": m.id,
        "contact_name": m.contact_name,
        "company_name": m.company_name,
        "sales_company_id": m.sales_company_id,
        "sale_deal_id": m.sale_deal_id,
        "service_type": m.service_type,
        "service_label": svc["label"],
        "service_bg": svc["bg"],
        "service_border": svc["border"],
        "service_accent": svc["accent"],
        "starts_at": m.starts_at.isoformat() if m.starts_at else None,
        "duration_minutes": m.duration_minutes,
        "notes": m.notes,
        "created_by_user_id": m.created_by_user_id,
        "created_by_user_name": m.created_by_user.name if m.created_by_user else None,
        "participants": [
            {"id": p.user_id, "name": p.user.name if p.user else f"#{p.user_id}"}
            for p in (m.participants or [])
        ],
    }


def _resolve_company(
    db: Session,
    slug: str,
    sales_company_id: Optional[int],
    company_name: str,
    current_user: User,
) -> tuple[str, Optional[int]]:
    if not sales_company_id:
        if not company_name.strip():
            raise HTTPException(status_code=400, detail="Укажите компанию")
        return company_name.strip(), None

    co = (
        db.query(SalesCompany)
        .filter(
            SalesCompany.id == sales_company_id,
            SalesCompany.company_slug == slug,
            SalesCompany.trashed_at.is_(None),
        )
        .first()
    )
    if not co:
        raise HTTPException(status_code=404, detail="Компания не найдена в клиентской базе")
    if not _can_access_sales_company(co, current_user):
        raise HTTPException(status_code=403, detail="Нет доступа к этой компании")
    return co.company_name, co.id


def _can_access_sales_company(co: SalesCompany, current_user: User) -> bool:
    if current_user.role == "admin":
        return True
    if is_sales_rop(current_user):
        return True
    return co.assigned_manager_id == current_user.id


def _resolve_deal(db: Session, slug: str, sale_deal_id: Optional[int], sales_company_id: Optional[int]) -> None:
    if not sale_deal_id:
        return
    deal = db.query(SaleDeal).filter(SaleDeal.id == sale_deal_id, SaleDeal.company_slug == slug).first()
    if not deal:
        raise HTTPException(status_code=404, detail="Сделка не найдена")
    if sales_company_id and deal.sales_company_id and deal.sales_company_id != sales_company_id:
        raise HTTPException(status_code=400, detail="Сделка не относится к выбранной компании")


def _set_participants(db: Session, meeting: SaleMeeting, user_ids: List[int], slug: str) -> None:
    meeting.participants.clear()
    if not user_ids:
        return
    users = (
        db.query(User)
        .filter(User.id.in_(user_ids), User.company_slug == slug, User.is_active == True)
        .all()
    )
    found = {u.id for u in users}
    missing = set(user_ids) - found
    if missing:
        raise HTTPException(status_code=400, detail=f"Участники не найдены: {sorted(missing)}")
    for uid in user_ids:
        meeting.participants.append(SaleMeetingParticipant(user_id=uid))


class MeetingIn(BaseModel):
    contact_name: str = Field(..., min_length=1, max_length=220)
    company_name: str = Field(default="", max_length=300)
    sales_company_id: Optional[int] = None
    sale_deal_id: Optional[int] = None
    service_type: str = Field(default="discovery", max_length=40)
    starts_at: str
    duration_minutes: int = Field(default=60, ge=15, le=480)
    notes: Optional[str] = None
    participant_user_ids: List[int] = Field(default_factory=list)


class MeetingUpdate(BaseModel):
    contact_name: Optional[str] = Field(None, min_length=1, max_length=220)
    company_name: Optional[str] = Field(None, max_length=300)
    sales_company_id: Optional[int] = None
    sale_deal_id: Optional[int] = None
    service_type: Optional[str] = Field(None, max_length=40)
    starts_at: Optional[str] = None
    duration_minutes: Optional[int] = Field(None, ge=15, le=480)
    notes: Optional[str] = None
    participant_user_ids: Optional[List[int]] = None


@router.get("/calendar/service-types")
def list_service_types(current_user: User = Depends(_require_sales)):
    return SERVICE_TYPES


@router.get("/calendar/meetings")
def list_meetings(
    date_from: str = Query(..., description="ISO datetime начала периода"),
    date_to: str = Query(..., description="ISO datetime конца периода"),
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_sales),
):
    slug = get_request_company()
    dt_from = _parse_dt(date_from)
    dt_to = _parse_dt(date_to)
    rows = (
        _meeting_query(db, slug, current_user)
        .filter(SaleMeeting.starts_at >= dt_from, SaleMeeting.starts_at < dt_to)
        .order_by(SaleMeeting.starts_at)
        .all()
    )
    return [_serialize(m) for m in rows]


@router.post("/calendar/meetings", status_code=201)
def create_meeting(
    data: MeetingIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_sales),
):
    slug = get_request_company()
    if data.service_type not in _SERVICE_BY_KEY:
        raise HTTPException(status_code=400, detail="Неизвестный тип услуги")

    company_name, sales_company_id = _resolve_company(
        db, slug, data.sales_company_id, data.company_name, current_user
    )
    _resolve_deal(db, slug, data.sale_deal_id, sales_company_id)

    participant_ids = list(dict.fromkeys(data.participant_user_ids))
    if current_user.id not in participant_ids:
        participant_ids.insert(0, current_user.id)

    meeting = SaleMeeting(
        company_slug=slug,
        contact_name=data.contact_name.strip(),
        company_name=company_name,
        sales_company_id=sales_company_id,
        sale_deal_id=data.sale_deal_id,
        service_type=data.service_type,
        starts_at=_parse_dt(data.starts_at),
        duration_minutes=data.duration_minutes,
        notes=data.notes,
        created_by_user_id=current_user.id,
    )
    db.add(meeting)
    db.flush()
    _set_participants(db, meeting, participant_ids, slug)
    db.commit()
    db.refresh(meeting)
    meeting = _meeting_query(db, slug, current_user).filter(SaleMeeting.id == meeting.id).first()
    return _serialize(meeting)


@router.patch("/calendar/meetings/{meeting_id}")
def update_meeting(
    meeting_id: int,
    data: MeetingUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_sales),
):
    slug = get_request_company()
    meeting = _meeting_query(db, slug, current_user).filter(SaleMeeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Встреча не найдена")

    if data.service_type is not None:
        if data.service_type not in _SERVICE_BY_KEY:
            raise HTTPException(status_code=400, detail="Неизвестный тип услуги")
        meeting.service_type = data.service_type

    sales_company_id = data.sales_company_id if data.sales_company_id is not None else meeting.sales_company_id
    if data.sales_company_id is not None or data.company_name is not None:
        cn = data.company_name if data.company_name is not None else meeting.company_name
        company_name, sales_company_id = _resolve_company(db, slug, sales_company_id, cn, current_user)
        meeting.company_name = company_name
        meeting.sales_company_id = sales_company_id

    if data.sale_deal_id is not None:
        _resolve_deal(db, slug, data.sale_deal_id, meeting.sales_company_id)
        meeting.sale_deal_id = data.sale_deal_id

    if data.contact_name is not None:
        meeting.contact_name = data.contact_name.strip()
    if data.starts_at is not None:
        meeting.starts_at = _parse_dt(data.starts_at)
    if data.duration_minutes is not None:
        meeting.duration_minutes = data.duration_minutes
    if data.notes is not None:
        meeting.notes = data.notes
    if data.participant_user_ids is not None:
        _set_participants(db, meeting, list(dict.fromkeys(data.participant_user_ids)), slug)

    db.commit()
    meeting = _meeting_query(db, slug, current_user).filter(SaleMeeting.id == meeting_id).first()
    return _serialize(meeting)


@router.delete("/calendar/meetings/{meeting_id}")
def delete_meeting(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_sales),
):
    slug = get_request_company()
    meeting = _meeting_query(db, slug, current_user).filter(SaleMeeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Встреча не найдена")
    db.delete(meeting)
    db.commit()
    return {"ok": True}
