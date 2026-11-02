"""Раздел «Активы»: позиции мероприятий, категории с цветом и три отметки перемещения."""
from __future__ import annotations

import re
import uuid
from pathlib import Path
from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from starlette.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_admin
from app.db.database import get_db, get_request_company
from app.models.event_asset import EventAsset, EventAssetAccess, EventAssetCategory, EventAssetSetting, EventAssetUsage
from app.models.user import User

router = APIRouter(prefix="/api/event-assets", tags=["event-assets"])

UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent.parent / "uploads" / "event_assets"
MAX_PHOTO_BYTES = 10 * 1024 * 1024
_ALLOWED_EXT = frozenset({".jpg", ".jpeg", ".png", ".webp", ".gif"})

CHECK_FIELDS = {
    "out_warehouse": ("out_warehouse_by", "out_warehouse_at"),
    "out_site": ("out_site_by", "out_site_at"),
    "back_warehouse": ("back_warehouse_by", "back_warehouse_at"),
}
_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


class CategoryIn(BaseModel):
    name: str
    color: str = "#ffffff"


class CategoryOut(BaseModel):
    id: int
    name: str
    color: str


class AssetIn(BaseModel):
    name: str
    description: Optional[str] = None
    quantity: int = 1
    category_id: Optional[int] = None
    added_on: Optional[date] = None
    price: Optional[float] = None
    market_rent: Optional[float] = None


class AssetPatch(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    quantity: Optional[int] = None
    category_id: Optional[int] = None
    clear_category: bool = False
    added_on: Optional[date] = None
    price: Optional[float] = None
    clear_price: bool = False
    market_rent: Optional[float] = None
    clear_market_rent: bool = False


class CheckIn(BaseModel):
    checked: bool


class CheckState(BaseModel):
    by: Optional[str] = None
    at: Optional[datetime] = None


class AssetOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    quantity: int
    category_id: Optional[int] = None
    out_warehouse: Optional[CheckState] = None
    out_site: Optional[CheckState] = None
    back_warehouse: Optional[CheckState] = None
    added_on: Optional[date] = None
    price: Optional[float] = None
    market_rent: Optional[float] = None
    has_photo: bool = False
    created_by: Optional[str] = None
    usage_count: int = 0
    rental_total: float = 0


class SectionState(BaseModel):
    enabled: bool


def _slug() -> str:
    return get_request_company()


def _flag(db: Session) -> bool:
    row = db.query(EventAssetSetting).filter(EventAssetSetting.company_slug == _slug()).first()
    return bool(row and row.enabled)


def _has_access(db: Session, user: User) -> bool:
    """Админ видит раздел, когда он открыт; остальные — только если админ поделился с ними."""
    if not _flag(db):
        return False
    if user.role == "admin":
        return True
    return (
        db.query(EventAssetAccess)
        .filter(EventAssetAccess.company_slug == _slug(), EventAssetAccess.user_id == user.id)
        .first()
        is not None
    )


def _ensure_access(db: Session, user: User) -> None:
    if user.role == "admin":
        return
    if not _has_access(db, user):
        raise HTTPException(status_code=403, detail="Раздел «Активы» не открыт для вас")


def _to_out(r: EventAsset, usages: Optional[List[EventAssetUsage]] = None) -> AssetOut:
    usages = usages or []
    def st(by, at):
        return CheckState(by=by, at=at) if by or at else None

    return AssetOut(
        id=int(r.id),
        name=r.name,
        description=r.description,
        quantity=int(r.quantity or 1),
        category_id=r.category_id,
        out_warehouse=st(r.out_warehouse_by, r.out_warehouse_at),
        out_site=st(r.out_site_by, r.out_site_at),
        back_warehouse=st(r.back_warehouse_by, r.back_warehouse_at),
        added_on=r.added_on,
        price=float(r.price) if r.price is not None else None,
        market_rent=float(r.market_rent) if r.market_rent is not None else None,
        has_photo=bool(r.photo_path),
        created_by=r.created_by,
        usage_count=len(usages),
        rental_total=float(sum((u.rental_cost or 0) for u in usages)),
    )


def _check_category(db: Session, category_id: Optional[int]) -> Optional[int]:
    if category_id is None:
        return None
    ok = (
        db.query(EventAssetCategory)
        .filter(EventAssetCategory.id == category_id, EventAssetCategory.company_slug == _slug())
        .first()
    )
    if not ok:
        raise HTTPException(status_code=400, detail="Категория не найдена")
    return int(category_id)


def _delete_photo_file(name: Optional[str]) -> None:
    if not name:
        return
    try:
        p = UPLOAD_DIR / name
        if p.is_file():
            p.unlink()
    except OSError:
        pass


def _usages_of(db: Session, asset_id: int) -> List[EventAssetUsage]:
    return db.query(EventAssetUsage).filter(EventAssetUsage.asset_id == asset_id, EventAssetUsage.company_slug == _slug()).all()


def _get_asset(db: Session, asset_id: int) -> EventAsset:
    row = db.query(EventAsset).filter(EventAsset.id == asset_id, EventAsset.company_slug == _slug()).first()
    if not row:
        raise HTTPException(status_code=404, detail="Позиция не найдена")
    return row


@router.get("/section", response_model=SectionState)
def get_section(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return SectionState(enabled=_has_access(db, user))


@router.put("/section", response_model=SectionState)
def set_section(body: SectionState, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    row = db.query(EventAssetSetting).filter(EventAssetSetting.company_slug == _slug()).first()
    if not row:
        row = EventAssetSetting(company_slug=_slug(), enabled=body.enabled)
        db.add(row)
    else:
        row.enabled = body.enabled
    db.commit()
    return SectionState(enabled=bool(row.enabled))


class AccessIn(BaseModel):
    user_ids: List[int]


@router.get("/access", response_model=AccessIn)
def get_access(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    rows = db.query(EventAssetAccess).filter(EventAssetAccess.company_slug == _slug()).all()
    return AccessIn(user_ids=[r.user_id for r in rows])


@router.put("/access", response_model=AccessIn)
def set_access(body: AccessIn, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """Кому открыт раздел «Активы» (кроме админа)."""
    ids = set(body.user_ids)
    valid = {
        u.id for u in db.query(User).filter(User.id.in_(ids), User.company_slug == _slug()).all()
    } if ids else set()
    db.query(EventAssetAccess).filter(EventAssetAccess.company_slug == _slug()).delete(synchronize_session=False)
    for uid in valid:
        db.add(EventAssetAccess(company_slug=_slug(), user_id=uid))
    db.commit()
    return AccessIn(user_ids=sorted(valid))


@router.get("/categories", response_model=List[CategoryOut])
def list_categories(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _ensure_access(db, user)
    rows = db.query(EventAssetCategory).filter(EventAssetCategory.company_slug == _slug()).order_by(EventAssetCategory.id).all()
    return [CategoryOut(id=r.id, name=r.name, color=r.color or "#ffffff") for r in rows]


def _clean_color(color: str) -> str:
    c = (color or "#ffffff").strip()
    if not _COLOR_RE.match(c):
        raise HTTPException(status_code=400, detail="Цвет в формате #RRGGBB")
    return c.lower()


@router.post("/categories", response_model=CategoryOut)
def create_category(body: CategoryIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _ensure_access(db, user)
    nm = body.name.strip()
    if not nm:
        raise HTTPException(status_code=400, detail="Укажите название категории")
    row = EventAssetCategory(company_slug=_slug(), name=nm, color=_clean_color(body.color))
    db.add(row)
    db.commit()
    db.refresh(row)
    return CategoryOut(id=row.id, name=row.name, color=row.color)


@router.patch("/categories/{category_id}", response_model=CategoryOut)
def update_category(category_id: int, body: CategoryIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _ensure_access(db, user)
    row = db.query(EventAssetCategory).filter(EventAssetCategory.id == category_id, EventAssetCategory.company_slug == _slug()).first()
    if not row:
        raise HTTPException(status_code=404, detail="Категория не найдена")
    nm = body.name.strip()
    if not nm:
        raise HTTPException(status_code=400, detail="Укажите название категории")
    row.name = nm
    row.color = _clean_color(body.color)
    db.commit()
    return CategoryOut(id=row.id, name=row.name, color=row.color)


@router.delete("/categories/{category_id}")
def delete_category(category_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _ensure_access(db, user)
    row = db.query(EventAssetCategory).filter(EventAssetCategory.id == category_id, EventAssetCategory.company_slug == _slug()).first()
    if not row:
        raise HTTPException(status_code=404, detail="Категория не найдена")
    db.query(EventAsset).filter(EventAsset.category_id == category_id).update({EventAsset.category_id: None})
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("", response_model=List[AssetOut])
def list_assets(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _ensure_access(db, user)
    rows = db.query(EventAsset).filter(EventAsset.company_slug == _slug()).order_by(EventAsset.id.desc()).all()
    by_asset: dict = {}
    for u in db.query(EventAssetUsage).filter(EventAssetUsage.company_slug == _slug()).all():
        by_asset.setdefault(u.asset_id, []).append(u)
    return [_to_out(r, by_asset.get(r.id)) for r in rows]


@router.post("", response_model=AssetOut)
def create_asset(body: AssetIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _ensure_access(db, user)
    nm = body.name.strip()
    if not nm:
        raise HTTPException(status_code=400, detail="Укажите название позиции")
    row = EventAsset(
        company_slug=_slug(),
        name=nm,
        description=(body.description or "").strip() or None,
        quantity=max(1, int(body.quantity or 1)),
        category_id=_check_category(db, body.category_id),
        added_on=body.added_on or date.today(),
        price=body.price,
        market_rent=body.market_rent,
        created_by=user.name,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_out(row)


@router.patch("/{asset_id}", response_model=AssetOut)
def update_asset(asset_id: int, body: AssetPatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _ensure_access(db, user)
    row = _get_asset(db, asset_id)
    if body.name is not None:
        nm = body.name.strip()
        if not nm:
            raise HTTPException(status_code=400, detail="Укажите название позиции")
        row.name = nm
    if body.description is not None:
        row.description = body.description.strip() or None
    if body.quantity is not None:
        row.quantity = max(1, int(body.quantity))
    if body.added_on is not None:
        row.added_on = body.added_on
    if body.clear_price:
        row.price = None
    elif body.price is not None:
        row.price = body.price
    if body.clear_market_rent:
        row.market_rent = None
    elif body.market_rent is not None:
        row.market_rent = body.market_rent
    if body.clear_category:
        row.category_id = None
    elif body.category_id is not None:
        row.category_id = _check_category(db, body.category_id)
    db.commit()
    db.refresh(row)
    return _to_out(row, _usages_of(db, row.id))


@router.put("/{asset_id}/checks/{check}", response_model=AssetOut)
def set_check(asset_id: int, check: str, body: CheckIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _ensure_access(db, user)
    if check not in CHECK_FIELDS:
        raise HTTPException(status_code=404, detail="Неизвестная отметка")
    row = _get_asset(db, asset_id)
    by_f, at_f = CHECK_FIELDS[check]
    if body.checked:
        setattr(row, by_f, user.name)
        setattr(row, at_f, datetime.now(timezone.utc))
    else:
        setattr(row, by_f, None)
        setattr(row, at_f, None)
    db.commit()
    db.refresh(row)
    return _to_out(row, _usages_of(db, row.id))


@router.delete("/{asset_id}")
def delete_asset(asset_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _ensure_access(db, user)
    row = _get_asset(db, asset_id)
    _delete_photo_file(row.photo_path)
    db.query(EventAssetUsage).filter(EventAssetUsage.asset_id == asset_id).delete(synchronize_session=False)
    db.delete(row)
    db.commit()
    return {"ok": True}


class UsageOut(BaseModel):
    id: int
    asset_id: int
    project_name: str
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    manager_name: Optional[str] = None
    quantity: int
    rental_cost: Optional[float] = None


class UsageItemIn(BaseModel):
    asset_id: int
    quantity: int = 1
    rental_cost: Optional[float] = None


class UsageBatchIn(BaseModel):
    project_name: str
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    manager_name: Optional[str] = None
    items: List[UsageItemIn]


class UsagePatch(BaseModel):
    project_name: Optional[str] = None
    rental_cost: Optional[float] = None
    clear_cost: bool = False


def _usage_out(u: EventAssetUsage) -> UsageOut:
    return UsageOut(
        id=u.id, asset_id=u.asset_id, project_name=u.project_name, date_from=u.date_from, date_to=u.date_to,
        manager_name=u.manager_name, quantity=int(u.quantity or 1),
        rental_cost=float(u.rental_cost) if u.rental_cost is not None else None,
    )


@router.get("/{asset_id}/usages", response_model=List[UsageOut])
def list_usages(asset_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _ensure_access(db, user)
    _get_asset(db, asset_id)
    rows = _usages_of(db, asset_id)
    rows.sort(key=lambda u: (u.date_from or date.min, u.id), reverse=True)
    return [_usage_out(u) for u in rows]


@router.post("/usages", response_model=List[UsageOut])
def add_usages(body: UsageBatchIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Записать в историю: актив ушёл на проект. Вызывается при оформлении PDF."""
    _ensure_access(db, user)
    nm = body.project_name.strip()
    if not nm:
        raise HTTPException(status_code=400, detail="Укажите название проекта")
    out = []
    export_id = uuid.uuid4().hex
    for it in body.items:
        _get_asset(db, it.asset_id)
        u = EventAssetUsage(
            company_slug=_slug(), export_id=export_id, asset_id=it.asset_id, project_name=nm, date_from=body.date_from,
            date_to=body.date_to, manager_name=(body.manager_name or "").strip() or None,
            quantity=max(1, int(it.quantity or 1)),
            rental_cost=it.rental_cost,
        )
        db.add(u)
        out.append(u)
    db.commit()
    return [_usage_out(u) for u in out]


@router.patch("/usages/{usage_id}", response_model=UsageOut)
def update_usage(usage_id: int, body: UsagePatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _ensure_access(db, user)
    u = db.query(EventAssetUsage).filter(EventAssetUsage.id == usage_id, EventAssetUsage.company_slug == _slug()).first()
    if not u:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    if body.project_name is not None and body.project_name.strip():
        u.project_name = body.project_name.strip()
    if body.clear_cost:
        u.rental_cost = None
    elif body.rental_cost is not None:
        u.rental_cost = body.rental_cost
    db.commit()
    return _usage_out(u)


@router.delete("/usages/{usage_id}")
def delete_usage(usage_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _ensure_access(db, user)
    u = db.query(EventAssetUsage).filter(EventAssetUsage.id == usage_id, EventAssetUsage.company_slug == _slug()).first()
    if not u:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    db.delete(u)
    db.commit()
    return {"ok": True}


class ArchiveItem(BaseModel):
    usage_id: int
    asset_id: int
    asset_name: str
    description: Optional[str] = None
    quantity: int
    rental_cost: Optional[float] = None
    market_rent: Optional[float] = None


class ArchiveProject(BaseModel):
    key: str
    project_name: str
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    manager_name: Optional[str] = None
    created_at: Optional[datetime] = None
    total: float = 0
    items: List[ArchiveItem]


@router.get("/archive", response_model=List[ArchiveProject])
def archive(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Архив: проекты, по которым оформляли PDF, со списком позиций и ценой аренды по факту."""
    _ensure_access(db, user)
    assets = {a.id: a for a in db.query(EventAsset).filter(EventAsset.company_slug == _slug()).all()}
    groups: dict = {}
    for u in db.query(EventAssetUsage).filter(EventAssetUsage.company_slug == _slug()).order_by(EventAssetUsage.id).all():
        key = u.export_id or f"legacy-{u.project_name}-{u.date_from}-{u.created_at}"
        g = groups.get(key)
        if not g:
            g = groups[key] = ArchiveProject(
                key=key, project_name=u.project_name, date_from=u.date_from, date_to=u.date_to,
                manager_name=u.manager_name, created_at=u.created_at, items=[],
            )
        a = assets.get(u.asset_id)
        g.items.append(ArchiveItem(
            usage_id=u.id, asset_id=u.asset_id, asset_name=a.name if a else "(удалено)",
            description=a.description if a else None, quantity=int(u.quantity or 1),
            rental_cost=float(u.rental_cost) if u.rental_cost is not None else None,
            market_rent=float(a.price) if a and a.price is not None else None,
        ))
        g.total += float(u.rental_cost or 0)
    res = list(groups.values())
    res.sort(key=lambda g: (g.created_at or datetime.min.replace(tzinfo=timezone.utc)), reverse=True)
    return res


@router.delete("/archive/{key}")
def delete_archive_project(key: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _ensure_access(db, user)
    q = db.query(EventAssetUsage).filter(EventAssetUsage.company_slug == _slug(), EventAssetUsage.export_id == key)
    if q.count() == 0:
        raise HTTPException(status_code=404, detail="Проект не найден")
    q.delete(synchronize_session=False)
    db.commit()
    return {"ok": True}


@router.post("/{asset_id}/photo", response_model=AssetOut)
async def upload_photo(asset_id: int, photo: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Фото для внутреннего учёта — в PDF не попадает."""
    _ensure_access(db, user)
    row = _get_asset(db, asset_id)
    ext = Path(photo.filename or "").suffix.lower()
    if ext not in _ALLOWED_EXT:
        raise HTTPException(status_code=400, detail="Фото: JPG, PNG, WEBP или GIF")
    body = await photo.read()
    if len(body) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=400, detail="Фото не больше 10 МБ")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{ext}"
    (UPLOAD_DIR / name).write_bytes(body)
    _delete_photo_file(row.photo_path)
    row.photo_path = name
    db.commit()
    db.refresh(row)
    return _to_out(row, _usages_of(db, row.id))


@router.get("/{asset_id}/photo")
def get_photo(asset_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _ensure_access(db, user)
    row = _get_asset(db, asset_id)
    path = UPLOAD_DIR / (row.photo_path or "")
    if not row.photo_path or not path.is_file():
        raise HTTPException(status_code=404, detail="Фото нет")
    return FileResponse(path)


@router.delete("/{asset_id}/photo", response_model=AssetOut)
def delete_photo(asset_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _ensure_access(db, user)
    row = _get_asset(db, asset_id)
    _delete_photo_file(row.photo_path)
    row.photo_path = None
    db.commit()
    db.refresh(row)
    return _to_out(row, _usages_of(db, row.id))
