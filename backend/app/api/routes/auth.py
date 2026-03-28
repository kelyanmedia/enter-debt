from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.models.user import User
from sqlalchemy import func
from app.core.security import verify_password, create_access_token, get_current_user, normalize_email, get_password_hash
from app.schemas.schemas import Token, UserOut, ProfileSelfUpdate

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


def authenticate_user(email: str, password: str, db: Session):
    email_key = normalize_email(email)
    pwd = (password or "").strip()
    user = db.query(User).filter(func.lower(User.email) == email_key).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный email или пароль",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not verify_password(pwd, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный email или пароль",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    if user.web_access is False:
        raise HTTPException(
            status_code=403,
            detail="Вход в веб-панель для этой учётной записи отключён. Используйте Telegram-бота.",
        )
    return user


def _record_web_login(user: User, db: Session) -> None:
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)


@router.post("/token", response_model=Token)
def login_form(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = authenticate_user(form_data.username, form_data.password, db)
    _record_web_login(user, db)
    access_token = create_access_token(data={"sub": str(user.id)})
    return Token(
        access_token=access_token,
        token_type="bearer",
        user=UserOut.model_validate(user)
    )


@router.post("/login", response_model=Token)
def login_json(data: LoginRequest, db: Session = Depends(get_db)):
    user = authenticate_user(data.email, data.password, db)
    _record_web_login(user, db)
    access_token = create_access_token(data={"sub": str(user.id)})
    return Token(
        access_token=access_token,
        token_type="bearer",
        user=UserOut.model_validate(user)
    )


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=UserOut)
def patch_me(
    data: ProfileSelfUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Свой email и/или пароль. Администратор по-прежнему управляет всеми учётками в /api/users."""
    pwd = (data.current_password or "").strip()
    user = db.query(User).filter(User.id == current_user.id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not verify_password(pwd, user.hashed_password):
        raise HTTPException(status_code=400, detail="Неверный текущий пароль")

    email_norm = normalize_email(str(data.email))
    changed = False
    if email_norm != user.email:
        if db.query(User).filter(func.lower(User.email) == email_norm, User.id != user.id).first():
            raise HTTPException(status_code=400, detail="Email уже занят")
        user.email = email_norm
        changed = True

    if data.new_password is not None:
        pv = data.new_password.strip()
        if pv:
            if len(pv) < 4:
                raise HTTPException(status_code=400, detail="Пароль: минимум 4 символа")
            user.hashed_password = get_password_hash(pv)
            changed = True

    if not changed:
        raise HTTPException(status_code=400, detail="Нет изменений: укажите другой email или новый пароль")

    db.commit()
    db.refresh(user)
    return user
