import json
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.db.database import get_db, get_request_company
from app.models.user import User
from sqlalchemy import func
import httpx
from app.finance.cash_flow_catalog import expense_categories_for_api

from app.core.config import settings
from app.core.security import verify_password, create_access_token, get_current_user, normalize_email, get_password_hash
from app.schemas.schemas import Token, UserOut, ProfileSelfUpdate

router = APIRouter(prefix="/api/auth", tags=["auth"])


class CompanyOut(BaseModel):
    slug: str
    name: str


class TelegramCcSettingsOut(BaseModel):
    notify_all: bool
    manager_ids: List[int]
    managers: List[dict]


class TelegramCcSettingsPut(BaseModel):
    notify_all: bool = False
    manager_ids: List[int] = []


class TelegramDividendSettingsOut(BaseModel):
    available_categories: List[dict]
    allowed_categories: List[str]
    default_category: str


class TelegramDividendSettingsPut(BaseModel):
    allowed_categories: List[str] = []
    default_category: str = "dividends"


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


def _telegram_dividend_available_categories() -> List[dict]:
    return expense_categories_for_api()


def _telegram_dividend_category_slugs() -> set[str]:
    return {str(x["slug"]) for x in _telegram_dividend_available_categories()}


def _decode_dividend_allowed_categories(raw: Optional[str]) -> List[str]:
    if not raw or not str(raw).strip():
        return ["dividends", "other"]
    try:
        data = json.loads(raw)
    except (TypeError, ValueError, json.JSONDecodeError):
        return ["dividends", "other"]
    if not isinstance(data, list):
        return ["dividends", "other"]
    valid = _telegram_dividend_category_slugs()
    out: List[str] = []
    seen = set()
    for item in data:
        slug = str(item).strip()
        if slug and slug in valid and slug not in seen:
            seen.add(slug)
            out.append(slug)
    return out or ["dividends", "other"]


def _normalize_dividend_settings(allowed_categories: List[str], default_category: str) -> tuple[List[str], str]:
    valid = _telegram_dividend_category_slugs()
    out: List[str] = []
    seen = set()
    for item in allowed_categories:
        slug = str(item).strip()
        if slug and slug in valid and slug not in seen:
            seen.add(slug)
            out.append(slug)
    if not out:
        raise HTTPException(status_code=400, detail="Выберите хотя бы одну категорию для команды /d")
    default_slug = str(default_category or "").strip()
    if default_slug not in valid:
        raise HTTPException(status_code=400, detail="Категория по умолчанию не найдена")
    if default_slug not in out:
        raise HTTPException(status_code=400, detail="Категория по умолчанию должна входить в список доступных")
    return out, default_slug


def _get_me_dividend_settings_payload(user: User) -> TelegramDividendSettingsOut:
    allowed = _decode_dividend_allowed_categories(user.telegram_dividend_allowed_categories)
    default_category = (user.telegram_dividend_default_category or "").strip() or "dividends"
    if default_category not in allowed:
        default_category = allowed[0]
    return TelegramDividendSettingsOut(
        available_categories=_telegram_dividend_available_categories(),
        allowed_categories=allowed,
        default_category=default_category,
    )


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


@router.get("/me/telegram-cc-settings", response_model=TelegramCcSettingsOut)
def get_me_telegram_cc_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Настройки доступны только администратору")
    user = (
        db.query(User)
        .filter(User.id == current_user.id, User.company_slug == get_request_company())
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    mids: List[int] = []
    raw = user.admin_telegram_notify_manager_ids
    if isinstance(raw, str) and raw.strip():
        try:
            mids = [int(x) for x in json.loads(raw)]
        except (TypeError, ValueError, json.JSONDecodeError):
            mids = []
    manager_rows = (
        db.query(User)
        .filter(
            User.role == "manager",
            User.is_active == True,
            User.company_slug == get_request_company(),
        )
        .order_by(User.name.asc(), User.id.asc())
        .all()
    )
    return TelegramCcSettingsOut(
        notify_all=bool(user.admin_telegram_notify_all),
        manager_ids=mids,
        managers=[{"id": int(m.id), "name": m.name} for m in manager_rows],
    )


@router.put("/me/telegram-cc-settings", response_model=TelegramCcSettingsOut)
def put_me_telegram_cc_settings(
    body: TelegramCcSettingsPut,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Настройки доступны только администратору")
    user = (
        db.query(User)
        .filter(User.id == current_user.id, User.company_slug == get_request_company())
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    valid_manager_ids = {
        int(r[0])
        for r in db.query(User.id)
        .filter(
            User.role == "manager",
            User.is_active == True,
            User.company_slug == get_request_company(),
        )
        .all()
    }
    unique_ids: List[int] = []
    seen = set()
    for raw_id in body.manager_ids:
        mid = int(raw_id)
        if mid in seen:
            continue
        seen.add(mid)
        if mid not in valid_manager_ids:
            raise HTTPException(status_code=400, detail=f"Менеджер {mid} не найден или неактивен")
        unique_ids.append(mid)

    user.admin_telegram_notify_all = bool(body.notify_all)
    user.admin_telegram_notify_manager_ids = json.dumps(unique_ids)
    db.commit()
    db.refresh(user)
    return get_me_telegram_cc_settings(db, current_user)


@router.get("/me/telegram-dividend-settings", response_model=TelegramDividendSettingsOut)
def get_me_telegram_dividend_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ("admin", "financier"):
        raise HTTPException(status_code=403, detail="Настройки /d доступны только администратору или финансисту")
    user = (
        db.query(User)
        .filter(User.id == current_user.id, User.company_slug == get_request_company())
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _get_me_dividend_settings_payload(user)


@router.put("/me/telegram-dividend-settings", response_model=TelegramDividendSettingsOut)
def put_me_telegram_dividend_settings(
    body: TelegramDividendSettingsPut,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ("admin", "financier"):
        raise HTTPException(status_code=403, detail="Настройки /d доступны только администратору или финансисту")
    user = (
        db.query(User)
        .filter(User.id == current_user.id, User.company_slug == get_request_company())
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    allowed, default_slug = _normalize_dividend_settings(body.allowed_categories, body.default_category)
    user.telegram_dividend_allowed_categories = json.dumps(allowed)
    user.telegram_dividend_default_category = default_slug
    db.commit()
    db.refresh(user)
    return _get_me_dividend_settings_payload(user)
