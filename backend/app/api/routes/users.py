from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List
from app.db.database import get_db
from app.models.user import User
from app.models.partner import Partner
from app.schemas.schemas import UserOut, UserCreate, UserUpdate, AssignedPartnersBody
from app.core.security import get_password_hash, get_current_user, require_admin, normalize_email

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=List[UserOut])
def list_users(db: Session = Depends(get_db), _=Depends(require_admin)):
    return db.query(User).filter(User.is_active == True).order_by(User.name).all()


@router.get("/managers-for-select", response_model=List[UserOut])
def managers_for_select(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Список менеджеров для фильтров и форм: админ — все менеджеры; менеджер — только себя."""
    if current_user.role == "admin":
        return db.query(User).filter(User.role == "manager", User.is_active == True).order_by(User.name).all()
    if current_user.role == "manager":
        return [current_user] if current_user.is_active else []
    return []


@router.post("", response_model=UserOut)
def create_user(data: UserCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    email_norm = normalize_email(str(data.email))
    if db.query(User).filter(func.lower(User.email) == email_norm).first():
        raise HTTPException(status_code=400, detail="Email уже зарегистрирован")
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
        hashed_password=get_password_hash(data.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    try:
        from app.services.feed_events import emit_user_created
        emit_user_created(db, user)
    except Exception:
        pass
    return user


def _apply_update(user: User, data: UserUpdate):
    for field, value in data.model_dump(exclude_none=True).items():
        if field == "password":
            setattr(user, "hashed_password", get_password_hash(value))
        elif field == "email" and value is not None:
            setattr(user, "email", normalize_email(str(value)))
        else:
            setattr(user, field, value)


@router.put("/{user_id}", response_model=UserOut)
def update_user(user_id: int, data: UserUpdate, db: Session = Depends(get_db), _=Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    _apply_update(user, data)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserOut)
def patch_user(user_id: int, data: UserUpdate, db: Session = Depends(get_db), _=Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    _apply_update(user, data)
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
