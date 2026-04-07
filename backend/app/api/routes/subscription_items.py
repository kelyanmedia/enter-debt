from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from starlette.responses import Response
from sqlalchemy.orm import Session

from app.db.database import get_db, get_request_company
from app.models.subscription_item import SubscriptionItem
from app.models.user import User
from app.schemas.schemas import SubscriptionItemCreate, SubscriptionItemOut, SubscriptionItemUpdate
from app.core.security import get_current_user
from app.services.subscription_reminders import sync_next_due_date_from_deadline

router = APIRouter(prefix="/api/subscription-items", tags=["subscription-items"])

VALID_CATEGORIES = frozenset({"household", "phones", "services"})
VALID_CURRENCY = frozenset({"USD", "UZS"})
VALID_RECURRENCE = frozenset({"once", "monthly", "yearly"})
VALID_STATUS = frozenset({"active", "inactive"})
VALID_PAYER = frozenset({"KM", "WW"})


def _ensure_subscriptions_access(user: User) -> None:
    if user.role == "admin":
        return
    if user.role == "administration" and bool(getattr(user, "can_view_subscriptions", False)):
        return
    if user.role == "employee":
        raise HTTPException(status_code=403, detail="Нет доступа")
    raise HTTPException(status_code=403, detail="Нет доступа к подпискам")


@router.get("", response_model=List[SubscriptionItemOut])
def list_items(
    category: str = Query(..., description="household | phones | services"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ensure_subscriptions_access(current_user)
    if category not in VALID_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"Категория: {', '.join(sorted(VALID_CATEGORIES))}",
        )
    rows = (
        db.query(SubscriptionItem)
        .filter(SubscriptionItem.category == category)
        .order_by(
            SubscriptionItem.next_deadline_at.asc().nullslast(),
            SubscriptionItem.next_due_date.asc().nullslast(),
            SubscriptionItem.id.desc(),
        )
        .all()
    )
    return [SubscriptionItemOut.model_validate(r) for r in rows]


@router.post("", response_model=SubscriptionItemOut)
def create_item(
    data: SubscriptionItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ensure_subscriptions_access(current_user)
    if data.category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail="Недопустимая категория")
    cur = (data.currency or "USD").upper()
    if cur not in VALID_CURRENCY:
        raise HTTPException(status_code=400, detail="Валюта: USD или UZS")
    if data.recurrence not in VALID_RECURRENCE:
        raise HTTPException(status_code=400, detail="Периодичность: once, monthly, yearly")
    if data.reminder_days_before not in (0, 1, 2):
        raise HTTPException(status_code=400, detail="Напоминание: 0, 1 или 2 дня")
    if data.status not in VALID_STATUS:
        raise HTTPException(status_code=400, detail="Статус: active или inactive")
    if data.payer_code is not None and data.payer_code not in VALID_PAYER:
        raise HTTPException(status_code=400, detail="Кто платит: KM или WW")

    row = SubscriptionItem(
        company_slug=get_request_company(),
        category=data.category,
        name=data.name.strip(),
        status=data.status,
        tag=data.tag,
        payer_code=data.payer_code,
        payment_method=data.payment_method,
        phone_number=data.phone_number,
        vendor=(data.vendor or "").strip() or None,
        amount=data.amount,
        currency=cur,
        billing_note=(data.billing_note or "").strip() or None,
        next_due_date=data.next_due_date,
        next_deadline_at=data.next_deadline_at,
        recurrence=data.recurrence,
        reminder_days_before=data.reminder_days_before,
        notes=(data.notes or "").strip() or None,
        link_url=(data.link_url or "").strip() or None,
    )
    sync_next_due_date_from_deadline(row)
    db.add(row)
    db.commit()
    db.refresh(row)
    return SubscriptionItemOut.model_validate(row)


@router.patch("/{item_id}", response_model=SubscriptionItemOut)
def update_item(
    item_id: int,
    data: SubscriptionItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ensure_subscriptions_access(current_user)
    row = (
        db.query(SubscriptionItem)
        .filter(
            SubscriptionItem.id == item_id,
            SubscriptionItem.company_slug == get_request_company(),
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    upd = data.model_dump(exclude_unset=True)
    if "currency" in upd and upd["currency"] is not None:
        upd["currency"] = str(upd["currency"]).upper()
        if upd["currency"] not in VALID_CURRENCY:
            raise HTTPException(status_code=400, detail="Валюта: USD или UZS")
    if "recurrence" in upd and upd["recurrence"] is not None:
        if upd["recurrence"] not in VALID_RECURRENCE:
            raise HTTPException(status_code=400, detail="Периодичность: once, monthly, yearly")
    if "reminder_days_before" in upd and upd["reminder_days_before"] is not None:
        if upd["reminder_days_before"] not in (0, 1, 2):
            raise HTTPException(status_code=400, detail="Напоминание: 0, 1 или 2 дня")
    if "status" in upd and upd["status"] is not None and upd["status"] not in VALID_STATUS:
        raise HTTPException(status_code=400, detail="Статус: active или inactive")
    if "payer_code" in upd and upd["payer_code"] is not None and upd["payer_code"] not in VALID_PAYER:
        raise HTTPException(status_code=400, detail="Кто платит: KM или WW")
    if "name" in upd and upd["name"] is not None:
        upd["name"] = str(upd["name"]).strip()
    if "vendor" in upd:
        v = upd["vendor"]
        upd["vendor"] = (str(v).strip() or None) if v is not None else None
    if "billing_note" in upd:
        v = upd["billing_note"]
        upd["billing_note"] = (str(v).strip() or None) if v is not None else None
    if "notes" in upd:
        v = upd["notes"]
        upd["notes"] = (str(v).strip() or None) if v is not None else None
    if "link_url" in upd:
        v = upd["link_url"]
        upd["link_url"] = (str(v).strip() or None) if v is not None else None

    deadline_touched = "next_deadline_at" in upd
    for k, v in upd.items():
        setattr(row, k, v)

    if deadline_touched:
        row.reminder_sent_for_deadline_at = None
        if row.next_deadline_at is None:
            row.next_due_date = None
        else:
            sync_next_due_date_from_deadline(row)

    db.commit()
    db.refresh(row)
    return SubscriptionItemOut.model_validate(row)


@router.delete("/{item_id}", status_code=204)
def delete_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ensure_subscriptions_access(current_user)
    row = (
        db.query(SubscriptionItem)
        .filter(
            SubscriptionItem.id == item_id,
            SubscriptionItem.company_slug == get_request_company(),
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    db.delete(row)
    db.commit()
    return Response(status_code=204)
