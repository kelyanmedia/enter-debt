from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.db.database import get_db
from app.models.user import User
from app.schemas.schemas import UserOut, UserCreate, UserUpdate
from app.core.security import get_password_hash, get_current_user, require_admin

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=List[UserOut])
def list_users(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(User).filter(User.is_active == True).all()


@router.post("", response_model=UserOut)
def create_user(data: UserCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email уже зарегистрирован")
    user = User(
        name=data.name,
        email=data.email,
        role=data.role,
        telegram_id=data.telegram_id,
        telegram_chat_id=data.telegram_chat_id,
        telegram_username=data.telegram_username,
        is_active=data.is_active,
        web_access=data.web_access,
        hashed_password=get_password_hash(data.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _apply_update(user: User, data: UserUpdate):
    for field, value in data.model_dump(exclude_none=True).items():
        if field == "password":
            setattr(user, "hashed_password", get_password_hash(value))
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
