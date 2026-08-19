"""CRUD имущества компании с загрузкой фото."""
from __future__ import annotations

import uuid
from base64 import urlsafe_b64encode
from datetime import date
from hashlib import sha256
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.orm import Session, joinedload
from starlette.responses import FileResponse, Response

from app.core.security import get_current_user, require_admin
from app.core.config import settings
from app.db.database import get_db, get_request_company
from app.models.company_asset import CompanyAsset
from app.models.user import User
from app.schemas.schemas import CompanyAssetOut

router = APIRouter(prefix="/api/company-assets", tags=["company-assets"])

UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent.parent / "uploads" / "company_assets"
MAX_PHOTO_BYTES = 10 * 1024 * 1024
_ALLOWED_EXT = frozenset({".jpg", ".jpeg", ".png", ".webp", ".gif"})
_ICLOUD_SECRET_PREFIX = "v1:"


def _icloud_cipher() -> Fernet:
    """Ключ получается из server SECRET_KEY: в БД не лежит отдельный ключ или открытый пароль."""
    key = urlsafe_b64encode(sha256(settings.SECRET_KEY.encode("utf-8")).digest())
    return Fernet(key)


def _encrypt_icloud_password(value: Optional[str]) -> Optional[str]:
    raw = (value or "").strip()
    if not raw:
        return None
    return _ICLOUD_SECRET_PREFIX + _icloud_cipher().encrypt(raw.encode("utf-8")).decode("ascii")


def _decrypt_icloud_password(value: Optional[str]) -> Optional[str]:
    raw = (value or "").strip()
    if not raw:
        return None
    # Совместимость с ранними тестовыми/ручными записями, если такие уже появились.
    if not raw.startswith(_ICLOUD_SECRET_PREFIX):
        return raw
    try:
        return _icloud_cipher().decrypt(raw[len(_ICLOUD_SECRET_PREFIX):].encode("ascii")).decode("utf-8")
    except (InvalidToken, UnicodeDecodeError):
        return None


def _ensure_access(user: User) -> None:
    if user.role == "admin":
        return
    if user.role == "administration" and bool(getattr(user, "can_view_accesses", False)):
        return
    raise HTTPException(status_code=403, detail="Нет доступа к разделу имущества")


def _ensure_upload_dir() -> None:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def _ext_from_filename(name: str) -> str:
    ext = Path(name).suffix.lower()
    if ext not in _ALLOWED_EXT:
        raise HTTPException(status_code=400, detail="Фото: JPG, PNG, WEBP или GIF")
    return ext


async def _save_photo(file: UploadFile) -> str:
    body = await file.read()
    if len(body) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=400, detail="Фото не больше 10 МБ")
    if not file.filename:
        raise HTTPException(status_code=400, detail="Укажите файл фото")
    ext = _ext_from_filename(file.filename)
    safe = f"{uuid.uuid4().hex}{ext}"
    _ensure_upload_dir()
    (UPLOAD_DIR / safe).write_bytes(body)
    return safe


def _delete_photo_file(path: Optional[str]) -> None:
    if not path:
        return
    try:
        p = UPLOAD_DIR / path
        if p.is_file():
            p.unlink()
    except OSError:
        pass


def _to_out(row: CompanyAsset, *, include_icloud_password: bool = False) -> CompanyAssetOut:
    return CompanyAssetOut(
        id=int(row.id),
        name=row.name,
        purchased_on=row.purchased_on,
        serial_number=row.serial_number,
        seller_contacts=row.seller_contacts,
        notes=row.notes,
        assigned_to_user_id=row.assigned_to_user_id,
        assigned_to_user_name=(row.assigned_to_user.name if row.assigned_to_user else None),
        issued_on=row.issued_on,
        issued_items=row.issued_items,
        storage_location=row.storage_location,
        icloud_login=row.icloud_login,
        icloud_password=(_decrypt_icloud_password(row.icloud_password) if include_icloud_password else None),
        has_icloud_password=bool(row.icloud_password),
        has_photo=bool(row.photo_path),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("", response_model=List[CompanyAssetOut])
def list_company_assets(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ensure_access(current_user)
    rows = (
        db.query(CompanyAsset)
        .options(joinedload(CompanyAsset.assigned_to_user))
        .filter(CompanyAsset.company_slug == get_request_company())
        .order_by(CompanyAsset.purchased_on.desc().nullslast(), CompanyAsset.id.desc())
        .all()
    )
    return [_to_out(r, include_icloud_password=current_user.role == "admin") for r in rows]


def _validate_assigned_user(db: Session, user_id: Optional[int]) -> Optional[int]:
    if user_id is None:
        return None
    user = (
        db.query(User)
        .filter(User.id == user_id, User.company_slug == get_request_company())
        .first()
    )
    if not user:
        raise HTTPException(status_code=400, detail="Сотрудник не найден в текущей организации")
    return int(user.id)


@router.post("", response_model=CompanyAssetOut)
async def create_company_asset(
    name: str = Form(...),
    purchased_on: Optional[date] = Form(None),
    serial_number: Optional[str] = Form(None),
    seller_contacts: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    assigned_to_user_id: Optional[int] = Form(None),
    issued_on: Optional[date] = Form(None),
    issued_items: Optional[str] = Form(None),
    storage_location: Optional[str] = Form(None),
    icloud_login: Optional[str] = Form(None),
    icloud_password: Optional[str] = Form(None),
    photo: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    nm = name.strip()
    if not nm:
        raise HTTPException(status_code=400, detail="Укажите название актива")
    photo_path = await _save_photo(photo) if photo and photo.filename else None
    row = CompanyAsset(
        company_slug=get_request_company(),
        name=nm,
        purchased_on=purchased_on,
        serial_number=(serial_number or "").strip() or None,
        seller_contacts=(seller_contacts or "").strip() or None,
        notes=(notes or "").strip() or None,
        assigned_to_user_id=_validate_assigned_user(db, assigned_to_user_id),
        issued_on=issued_on,
        issued_items=(issued_items or "").strip() or None,
        storage_location=(storage_location or "").strip() or None,
        icloud_login=(icloud_login or "").strip() or None,
        icloud_password=_encrypt_icloud_password(icloud_password),
        photo_path=photo_path,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_out(row, include_icloud_password=True)


@router.patch("/{asset_id}", response_model=CompanyAssetOut)
async def update_company_asset(
    asset_id: int,
    name: Optional[str] = Form(None),
    purchased_on: Optional[date] = Form(None),
    serial_number: Optional[str] = Form(None),
    seller_contacts: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    assigned_to_user_id: Optional[int] = Form(None),
    clear_assigned_to_user: bool = Form(False),
    issued_on: Optional[date] = Form(None),
    issued_items: Optional[str] = Form(None),
    storage_location: Optional[str] = Form(None),
    icloud_login: Optional[str] = Form(None),
    icloud_password: Optional[str] = Form(None),
    clear_icloud_password: bool = Form(False),
    photo: Optional[UploadFile] = File(None),
    remove_photo: bool = Form(False),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    row = (
        db.query(CompanyAsset)
        .filter(CompanyAsset.id == asset_id, CompanyAsset.company_slug == get_request_company())
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    if name is not None:
        nm = name.strip()
        if not nm:
            raise HTTPException(status_code=400, detail="Укажите название актива")
        row.name = nm
    if purchased_on is not None:
        row.purchased_on = purchased_on
    if serial_number is not None:
        row.serial_number = serial_number.strip() or None
    if seller_contacts is not None:
        row.seller_contacts = seller_contacts.strip() or None
    if notes is not None:
        row.notes = notes.strip() or None
    if assigned_to_user_id is not None:
        row.assigned_to_user_id = _validate_assigned_user(db, assigned_to_user_id)
    elif clear_assigned_to_user:
        row.assigned_to_user_id = None
    if issued_on is not None:
        row.issued_on = issued_on
    if issued_items is not None:
        row.issued_items = issued_items.strip() or None
    if storage_location is not None:
        row.storage_location = storage_location.strip() or None
    if icloud_login is not None:
        row.icloud_login = icloud_login.strip() or None
    if icloud_password is not None:
        row.icloud_password = _encrypt_icloud_password(icloud_password)
    elif clear_icloud_password:
        row.icloud_password = None
    if remove_photo:
        _delete_photo_file(row.photo_path)
        row.photo_path = None
    if photo and photo.filename:
        _delete_photo_file(row.photo_path)
        row.photo_path = await _save_photo(photo)
    db.commit()
    db.refresh(row)
    return _to_out(row, include_icloud_password=True)


@router.delete("/{asset_id}", status_code=204)
def delete_company_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    row = (
        db.query(CompanyAsset)
        .options(joinedload(CompanyAsset.assigned_to_user))
        .filter(CompanyAsset.id == asset_id, CompanyAsset.company_slug == get_request_company())
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    _delete_photo_file(row.photo_path)
    db.delete(row)
    db.commit()
    return Response(status_code=204)


@router.get("/{asset_id}/photo")
def get_company_asset_photo(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ensure_access(current_user)
    row = (
        db.query(CompanyAsset)
        .filter(CompanyAsset.id == asset_id, CompanyAsset.company_slug == get_request_company())
        .first()
    )
    if not row or not row.photo_path:
        raise HTTPException(status_code=404, detail="Фото не найдено")
    path = UPLOAD_DIR / row.photo_path
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Файл фото не найден")
    ext = path.suffix.lower()
    media = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }.get(ext, "application/octet-stream")
    return FileResponse(path, media_type=media, filename=path.name)
