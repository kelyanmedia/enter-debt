import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from app.db.database import get_db
from app.models.user import User
from app.models.partner import Partner
from app.schemas.schemas import UserOut, UserCreate, UserUpdate, AssignedPartnersBody
from app.core.security import get_password_hash, get_current_user, require_admin, normalize_email

router = APIRouter(prefix="/api/users", tags=["users"])


def _validate_visible_manager_ids(db: Session, ids: Optional[List[int]]) -> List[int]:
    if not ids:
        raise HTTPException(status_code=400, detail="Укажите хотя бы одного менеджера для роли «Администрация»")
    uniq: List[int] = []
    seen = set()
    for x in ids:
        i = int(x)
        if i not in seen:
            seen.add(i)
            uniq.append(i)
    for mid in uniq:
        u = db.query(User).filter(User.id == mid, User.role == "manager", User.is_active == True).first()
        if not u:
            raise HTTPException(status_code=400, detail=f"Пользователь {mid} не является активным менеджером")
    return uniq


@router.get("", response_model=List[UserOut])
def list_users(db: Session = Depends(get_db), _=Depends(require_admin)):
    return db.query(User).filter(User.is_active == True).order_by(User.name).all()


@router.get("/managers-for-select", response_model=List[UserOut])
def managers_for_select(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Список менеджеров для фильтров и форм: админ — все; администрация — только из списка; менеджер — себя."""
    if current_user.role == "admin":
        return db.query(User).filter(User.role == "manager", User.is_active == True).order_by(User.name).all()
    if current_user.role == "administration":
        from app.core.access import parse_visible_manager_ids
        mids = parse_visible_manager_ids(current_user)
        if not mids:
            return []
        return (
            db.query(User)
            .filter(User.id.in_(mids), User.role == "manager", User.is_active == True)
            .order_by(User.name)
            .all()
        )
    if current_user.role == "manager":
        return [current_user] if current_user.is_active else []
    return []


@router.post("", response_model=UserOut)
def create_user(data: UserCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    email_norm = normalize_email(str(data.email))
    if db.query(User).filter(func.lower(User.email) == email_norm).first():
        raise HTTPException(status_code=400, detail="Email уже зарегистрирован")
    plain = (data.password or "").strip()
    if len(plain) < 4:
        raise HTTPException(status_code=400, detail="Пароль: минимум 4 символа")
    if data.role not in ("admin", "manager", "accountant", "administration", "employee"):
        raise HTTPException(status_code=400, detail="Недопустимая роль")
    vm_json = None
    if data.role == "administration":
        vm_json = json.dumps(_validate_visible_manager_ids(db, getattr(data, "visible_manager_ids", None)))
    pd = None
    if data.role == "employee" and getattr(data, "payment_details", None):
        pd = str(data.payment_details).strip() or None
    user = User(
        name=data.name,
        email=email_norm,
        role=data.role,
        telegram_id=data.telegram_id,
        telegram_chat_id=data.telegram_chat_id,
        telegram_username=data.telegram_username,
        is_active=data.is_active,
        web_access=data.web_access,
        see_all_partners=data.see_all_partners if data.role == "manager" else False,
        visible_manager_ids=vm_json,
        payment_details=pd,
        hashed_password=get_password_hash(plain),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    from app.services.feed_events import emit_user_created
    emit_user_created(user.id, user.name, user.email)
    return user


def _apply_update(user: User, data: UserUpdate):
    for field, value in data.model_dump(exclude_none=True).items():
        if field == "visible_manager_ids":
            continue
        if field == "password":
            pv = (value or "").strip()
            if not pv:
                continue
            if len(pv) < 4:
                raise HTTPException(status_code=400, detail="Пароль: минимум 4 символа")
            setattr(user, "hashed_password", get_password_hash(pv))
        elif field == "email" and value is not None:
            setattr(user, "email", normalize_email(str(value)))
        else:
            setattr(user, field, value)


def _sync_visible_managers_after_user_update(db: Session, user: User, data: UserUpdate) -> None:
    from app.core.access import parse_visible_manager_ids

    if data.role is not None and data.role != "administration":
        user.visible_manager_ids = None
    if data.visible_manager_ids is not None:
        if user.role != "administration":
            raise HTTPException(status_code=400, detail="Список менеджеров задаётся только для роли «Администрация»")
        user.visible_manager_ids = json.dumps(_validate_visible_manager_ids(db, data.visible_manager_ids))
    if user.role == "administration" and not parse_visible_manager_ids(user):
        raise HTTPException(status_code=400, detail="Укажите хотя бы одного менеджера для роли «Администрация»")
    if data.role is not None and data.role != "employee":
        user.payment_details = None


@router.put("/{user_id}", response_model=UserOut)
def update_user(user_id: int, data: UserUpdate, db: Session = Depends(get_db), _=Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    _apply_update(user, data)
    _sync_visible_managers_after_user_update(db, user, data)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserOut)
def patch_user(user_id: int, data: UserUpdate, db: Session = Depends(get_db), _=Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    _apply_update(user, data)
    _sync_visible_managers_after_user_update(db, user, data)
    db.commit()
    db.refresh(user)
    return user


@router.get("/{user_id}/assigned-partners")
def get_assigned_partners(user_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user or user.role != "manager":
        raise HTTPException(status_code=400, detail="Только для менеджеров")
    ids = (
        db.query(Partner.id)
        .filter(Partner.manager_id == user_id, Partner.is_deleted == False)
        .all()
    )
    return {"partner_ids": [r[0] for r in ids]}


@router.put("/{user_id}/assigned-partners")
def set_assigned_partners(
    user_id: int,
    body: AssignedPartnersBody,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user or user.role != "manager":
        raise HTTPException(status_code=400, detail="Только для менеджеров")
    db.query(Partner).filter(Partner.manager_id == user_id).update(
        {Partner.manager_id: None}, synchronize_session=False
    )
    for pid in body.partner_ids:
        p = db.query(Partner).filter(Partner.id == pid, Partner.is_deleted == False).first()
        if p:
            p.manager_id = user_id
    db.commit()
    return {"ok": True, "partner_ids": body.partner_ids}


@router.delete("/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = False
    db.commit()
    return {"ok": True}


# ── Internal endpoints for bot (no auth required, internal network only) ──────

@router.get("/internal/by-chat/{chat_id}")
def get_user_by_chat(chat_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.telegram_chat_id == chat_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": user.id, "name": user.name, "role": user.role, "telegram_chat_id": user.telegram_chat_id}


@router.get("/internal/managers")
def get_managers(db: Session = Depends(get_db)):
    managers = db.query(User).filter(
        User.role.in_(["manager", "admin"]),
        User.is_active == True,
        User.telegram_chat_id.isnot(None)
    ).all()
    return [{"id": u.id, "name": u.name, "telegram_chat_id": u.telegram_chat_id} for u in managers]


@router.get("/internal/telegram-chat-by-user/{user_id}")
def internal_telegram_chat_by_user(user_id: int, db: Session = Depends(get_db)):
    """Для бота: chat id пользователя с привязанным Telegram (менеджер/админ)."""
    u = db.query(User).filter(
        User.id == user_id,
        User.is_active == True,
        User.telegram_chat_id.isnot(None),
    ).first()
    if not u:
        raise HTTPException(status_code=404, detail="User or telegram not linked")
    return {"telegram_chat_id": int(u.telegram_chat_id), "name": u.name}


@router.get("/internal/accountants")
def internal_accountants(db: Session = Depends(get_db)):
    """Активные бухгалтеры с Telegram — для пересылки сообщений из бота."""
    rows = (
        db.query(User)
        .filter(
            User.role == "accountant",
            User.is_active == True,
            User.telegram_chat_id.isnot(None),
        )
        .order_by(User.id.asc())
        .all()
    )
    return [
        {"id": u.id, "name": u.name, "telegram_chat_id": int(u.telegram_chat_id)}
        for u in rows
    ]
