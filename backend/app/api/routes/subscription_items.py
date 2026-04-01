from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from starlette.responses import Response
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.subscription_item import SubscriptionItem
from app.models.user import User
from app.schemas.schemas import SubscriptionItemCreate, SubscriptionItemOut, SubscriptionItemUpdate
from app.core.security import get_current_user

router = APIRouter(prefix="/api/subscription-items", tags=["subscription-items"])

VALID_CATEGORIES = frozenset({"household", "phones", "services"})
VALID_CURRENCY = frozenset({"USD", "UZS"})


def _reject_employee(user: User) -> None:
    if user.role == "employee":
        raise HTTPException(status_code=403, detail="Нет доступа")


@router.get("", response_model=List[SubscriptionItemOut])
def list_items(
    category: str = Query(..., description="household | phones | services"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _reject_employee(current_user)
    if category not in VALID_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"Категория: {', '.join(sorted(VALID_CATEGORIES))}",
        )
    rows = (
        db.query(SubscriptionItem)
        .filter(SubscriptionItem.category == category)
        .order_by(SubscriptionItem.next_due_date.asc().nullslast(), SubscriptionItem.id.desc())
        .all()
    )
    return [SubscriptionItemOut.model_validate(r) for r in rows]


@router.post("", response_model=SubscriptionItemOut)
def create_item(
    data: SubscriptionItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _reject_employee(current_user)
    if data.category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail="Недопустимая категория")
    cur = (data.currency or "USD").upper()
    if cur not in VALID_CURRENCY:
        raise HTTPException(status_code=400, detail="Валюта: USD или UZS")
    row = SubscriptionItem(
        category=data.category,
        name=data.name.strip(),
        vendor=(data.vendor or "").strip() or None,
        amount=data.amount,
        currency=cur,
        billing_note=(data.billing_note or "").strip() or None,
        next_due_date=data.next_due_date,
        notes=(data.notes or "").strip() or None,
        link_url=(data.link_url or "").strip() or None,
    )
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
    _reject_employee(current_user)
    row = db.query(SubscriptionItem).filter(SubscriptionItem.id == item_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    upd = data.model_dump(exclude_unset=True)
    if "currency" in upd and upd["currency"] is not None:
        upd["currency"] = str(upd["currency"]).upper()
        if upd["currency"] not in VALID_CURRENCY:
            raise HTTPException(status_code=400, detail="Валюта: USD или UZS")
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
    for k, v in upd.items():
        setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return SubscriptionItemOut.model_validate(row)


@router.delete("/{item_id}", status_code=204)
def delete_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _reject_employee(current_user)
    row = db.query(SubscriptionItem).filter(SubscriptionItem.id == item_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    db.delete(row)
    db.commit()
    return Response(status_code=204)
