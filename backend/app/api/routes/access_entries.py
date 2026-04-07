from typing import List

from fastapi import APIRouter, Depends, HTTPException
from starlette.responses import Response
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_admin
from app.db.database import get_db, get_request_company
from app.models.access_entry import AccessEntry
from app.models.user import User
from app.schemas.schemas import AccessEntryCreate, AccessEntryOut, AccessEntryUpdate

router = APIRouter(prefix="/api/access-entries", tags=["access-entries"])

VALID_CATEGORIES = frozenset({"email", "telegram", "device", "service"})


def _ensure_access(user: User) -> None:
    if user.role == "admin":
        return
    if user.role == "administration" and bool(getattr(user, "can_view_accesses", False)):
        return
    if user.role not in ("admin", "administration"):
        raise HTTPException(status_code=403, detail="Нет доступа")
    raise HTTPException(status_code=403, detail="Нет доступа к разделу доступов")


@router.get("", response_model=List[AccessEntryOut])
def list_access_entries(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ensure_access(current_user)
    q = db.query(AccessEntry)
    if current_user.role == "administration":
        q = q.filter(AccessEntry.shared_with_administration == True)
    rows = q.order_by(
        AccessEntry.employee_name.asc(),
        AccessEntry.category.asc(),
        AccessEntry.id.desc(),
    ).all()
    return [AccessEntryOut.model_validate(r) for r in rows]


@router.post("", response_model=AccessEntryOut)
def create_access_entry(
    data: AccessEntryCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    if data.category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail="Категория: email | telegram | device | service")
    row = AccessEntry(
        company_slug=get_request_company(),
        employee_name=data.employee_name.strip(),
        category=data.category,
        title=data.title.strip(),
        service_type=(data.service_type or "").strip() or None,
        shared_with_administration=bool(data.shared_with_administration),
        login=(data.login or "").strip() or None,
        password=(data.password or "").strip() or None,
        phone_number=(data.phone_number or "").strip() or None,
        twofa_code=(data.twofa_code or "").strip() or None,
        reserve_email=(data.reserve_email or "").strip() or None,
        device_model=(data.device_model or "").strip() or None,
        serial_number=(data.serial_number or "").strip() or None,
        charge_cycles=data.charge_cycles,
        photo_url=(data.photo_url or "").strip() or None,
        notes=(data.notes or "").strip() or None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return AccessEntryOut.model_validate(row)


@router.patch("/{entry_id}", response_model=AccessEntryOut)
def update_access_entry(
    entry_id: int,
    data: AccessEntryUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    row = (
        db.query(AccessEntry)
        .filter(
            AccessEntry.id == entry_id,
            AccessEntry.company_slug == get_request_company(),
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    upd = data.model_dump(exclude_unset=True)
    if "category" in upd and upd["category"] not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail="Категория: email | telegram | device | service")
    for field in (
        "employee_name",
        "title",
        "service_type",
        "login",
        "password",
        "phone_number",
        "twofa_code",
        "reserve_email",
        "device_model",
        "serial_number",
        "photo_url",
        "notes",
    ):
        if field in upd:
            v = upd[field]
            upd[field] = (str(v).strip() or None) if v is not None else None
    for k, v in upd.items():
        setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return AccessEntryOut.model_validate(row)


@router.delete("/{entry_id}", status_code=204)
def delete_access_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    row = (
        db.query(AccessEntry)
        .filter(
            AccessEntry.id == entry_id,
            AccessEntry.company_slug == get_request_company(),
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    db.delete(row)
    db.commit()
    return Response(status_code=204)
