from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.db.database import get_db, get_request_company
from app.models.user import User
from sqlalchemy import func
import httpx

from app.core.config import settings
from app.core.security import verify_password, create_access_token, get_current_user, normalize_email, get_password_hash
from app.schemas.schemas import Token, UserOut, ProfileSelfUpdate

router = APIRouter(prefix="/api/auth", tags=["auth"])


class CompanyOut(BaseModel):
    slug: str
    name: str


def compute_companies_list() -> List[CompanyOut]:
    """Список компаний для UI (без авторизации). Вынесено для дубля маршрута /auth/companies при proxy без префикса /api."""
    from app.core.companies import COMPANY_LABELS, COMPANY_SLUG_ORDER
    from app.db.database import is_registered_company_slug

    return [
        CompanyOut(slug=s, name=COMPANY_LABELS[s])
        for s in COMPANY_SLUG_ORDER
        if is_registered_company_slug(s)
    ]


@router.get("/companies", response_model=List[CompanyOut])
def list_companies_public():
    """Список компаний для переключателя в UI (без авторизации)."""
    return compute_companies_list()


class LoginRequest(BaseModel):
    email: str
    password: str


def authenticate_user(email: str, password: str, db: Session):
    email_key = normalize_email(email)
    pwd = (password or "").strip()
    user = (
        db.query(User)
        .filter(
            func.lower(User.email) == email_key,
            User.company_slug == get_request_company(),
        )
        .first()
    )
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


def perform_json_login(data: LoginRequest, db: Session) -> Token:
    """Общая логика POST /api/auth/login и POST /auth/login (если nginx отрезает /api)."""
    user = authenticate_user(data.email, data.password, db)
    _record_web_login(user, db)
    access_token = create_access_token(data={"sub": str(user.id)})
    return Token(
        access_token=access_token,
        token_type="bearer",
        user=UserOut.model_validate(user),
    )


@router.post("/login", response_model=Token)
def login_json(data: LoginRequest, db: Session = Depends(get_db)):
    return perform_json_login(data, db)


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/me/telegram-ping", response_model=dict)
def post_me_telegram_ping(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Тестовое сообщение в Telegram текущего пользователя — проверка, что пуши доходят.
    """
    user = (
        db.query(User)
        .filter(User.id == current_user.id, User.company_slug == get_request_company())
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.telegram_chat_id:
        raise HTTPException(
            status_code=400,
            detail="Telegram не привязан. Откройте бота EnterDebt, выполните /start и дождитесь одобрения заявки администратором.",
        )
    if not settings.BOT_TOKEN:
        raise HTTPException(status_code=503, detail="BOT_TOKEN не настроен на сервере")
    url = f"https://api.telegram.org/bot{settings.BOT_TOKEN}/sendMessage"
    text = (
        "🔔 <b>EnterDebt</b> — тестовое уведомление.\n\n"
        "Если вы видите это сообщение, доставка пушей в ваш чат работает."
    )
    try:
        r = httpx.post(
            url,
            json={"chat_id": int(user.telegram_chat_id), "text": text, "parse_mode": "HTML"},
            timeout=15,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Сеть Telegram: {e}") from e
    if r.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Telegram отклонил сообщение: {r.text[:200]}",
        )
    return {"ok": True}


@router.patch("/me", response_model=UserOut)
def patch_me(
    data: ProfileSelfUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Свой email, пароль и (для сотрудника) реквизиты. Остальные роли — /api/users у админа."""
    pwd = (data.current_password or "").strip()
    user = (
        db.query(User)
        .filter(User.id == current_user.id, User.company_slug == get_request_company())
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not verify_password(pwd, user.hashed_password):
        raise HTTPException(status_code=400, detail="Неверный текущий пароль")

    payload = data.model_dump(exclude_unset=True)

    email_norm = normalize_email(str(data.email))
    changed = False
    if email_norm != user.email:
        if (
            db.query(User)
            .filter(
                func.lower(User.email) == email_norm,
                User.id != user.id,
                User.company_slug == get_request_company(),
            )
            .first()
        ):
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

    if "payment_details" in payload:
        if user.role != "employee":
            raise HTTPException(status_code=400, detail="Реквизиты можно менять только в профиле сотрудника")
        raw = payload["payment_details"]
        new_val = None if raw is None else str(raw).strip() or None
        old_val = (user.payment_details or "").strip() or None
        if new_val != old_val:
            user.payment_details = new_val
            user.payment_details_updated_at = datetime.now(timezone.utc)
            changed = True

    if not changed:
        raise HTTPException(
            status_code=400,
            detail="Нет изменений: другой email, новый пароль или обновлённые реквизиты",
        )

    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)
