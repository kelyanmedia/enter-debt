import json
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Literal, Optional
from app.core.companies import normalize_company_slug
from app.core.config import settings
from app.db.database import get_db, get_request_company, is_registered_company_slug
from app.models.cash_flow import CashFlowEntry
from app.models.user import User
from app.models.partner import Partner
from app.schemas.schemas import UserOut, UserCreate, UserUpdate, AssignedPartnersBody
from app.core.security import get_password_hash, get_current_user, require_admin, normalize_email

router = APIRouter(prefix="/api/users", tags=["users"])


def _verify_internal_secret(
    x_internal_secret: Optional[str] = Header(None, alias="X-Internal-Secret"),
):
    if not settings.INTERNAL_API_SECRET or x_internal_secret != settings.INTERNAL_API_SECRET:
        raise HTTPException(status_code=401, detail="Invalid internal secret")
    return True


class InternalTelegramDividendIn(BaseModel):
    chat_id: int
    amount_uzs: Decimal = Decimal("0")
    amount_usd: Decimal = Decimal("0")
    note: Optional[str] = Field(default=None, max_length=500)
    payment_method: Literal["cash", "card", "transfer"] = "transfer"
    entry_date: Optional[date] = None

    @model_validator(mode="after")
    def _validate_amount(self):
        if self.amount_uzs <= 0 and self.amount_usd <= 0:
            raise ValueError("Укажите сумму в UZS или USD больше нуля")
        return self


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
        u = (
            db.query(User)
            .filter(
                User.id == mid,
                User.role == "manager",
                User.is_active == True,
                User.company_slug == get_request_company(),
            )
            .first()
        )
        if not u:
            raise HTTPException(status_code=400, detail=f"Пользователь {mid} не является активным менеджером")
    return uniq


def _encode_admin_accessible_company_slugs(slugs: List[str], home_slug: str) -> str:
    """Нормализует slug, гарантирует home_slug, возвращает JSON."""
    uniq: List[str] = []
    seen = set()
    for raw in slugs:
        s = normalize_company_slug(str(raw).strip())
        if not s or not is_registered_company_slug(s):
            raise HTTPException(status_code=400, detail=f"Неизвестная организация: {raw}")
        if s not in seen:
            seen.add(s)
            uniq.append(s)
    if home_slug not in seen:
        uniq.insert(0, home_slug)
    return json.dumps(uniq)


def _validate_notify_manager_ids(db: Session, ids: Optional[List[int]]) -> List[int]:
    """Список менеджеров для копий Telegram у администратора; пустой список допустим."""
    if not ids:
        return []
    uniq: List[int] = []
    seen = set()
    for x in ids:
        i = int(x)
        if i not in seen:
            seen.add(i)
            uniq.append(i)
    for mid in uniq:
        u = (
            db.query(User)
            .filter(
                User.id == mid,
                User.role == "manager",
                User.is_active == True,
                User.company_slug == get_request_company(),
            )
            .first()
        )
        if not u:
            raise HTTPException(status_code=400, detail=f"Пользователь {mid} не является активным менеджером")
    return uniq


def _normalize_telegram_username(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    return raw[1:] if raw.startswith("@") else raw


def _transfer_telegram_chat_id(
    db: Session,
    target_user: User,
    chat_id: Optional[int],
) -> Optional[str]:
    """Передаёт chat_id целевому пользователю, снимая его с любой другой учётки."""
    if chat_id is None:
        return None
    moved_username: Optional[str] = None
    q = db.query(User).filter(User.telegram_chat_id == int(chat_id))
    if target_user.id is not None:
        q = q.filter(User.id != target_user.id)
    holders = q.all()
    for holder in holders:
        if moved_username is None and holder.telegram_username:
            moved_username = holder.telegram_username
        holder.telegram_chat_id = None
        holder.telegram_username = None
    return moved_username


@router.get("", response_model=List[UserOut])
def list_users(db: Session = Depends(get_db), _=Depends(require_admin)):
    return (
        db.query(User)
        .filter(User.is_active == True, User.company_slug == get_request_company())
        .order_by(User.name)
        .all()
    )


@router.get("/managers-for-select", response_model=List[UserOut])
def managers_for_select(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Список менеджеров для фильтров и форм: админ — все; администрация — только из списка; менеджер — себя."""
    if current_user.role == "admin":
        return (
            db.query(User)
            .filter(
                User.role == "manager",
                User.is_active == True,
                User.company_slug == get_request_company(),
            )
            .order_by(User.name)
            .all()
        )
    if current_user.role == "administration":
        from app.core.access import parse_visible_manager_ids
        mids = parse_visible_manager_ids(current_user)
        if not mids:
            return []
        return (
            db.query(User)
            .filter(
                User.id.in_(mids),
                User.role == "manager",
                User.is_active == True,
                User.company_slug == get_request_company(),
            )
            .order_by(User.name)
            .all()
        )
    if current_user.role == "manager":
        return [current_user] if current_user.is_active else []
    return []


@router.post("", response_model=UserOut)
def create_user(data: UserCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    email_norm = normalize_email(str(data.email))
    if (
        db.query(User)
        .filter(
            func.lower(User.email) == email_norm,
            User.company_slug == get_request_company(),
        )
        .first()
    ):
        raise HTTPException(status_code=400, detail="Email уже зарегистрирован")
    plain = (data.password or "").strip()
    if len(plain) < 4:
        raise HTTPException(status_code=400, detail="Пароль: минимум 4 символа")
    if data.role not in ("admin", "manager", "accountant", "financier", "administration", "employee"):
        raise HTTPException(status_code=400, detail="Недопустимая роль")
    vm_json = None
    if data.role == "administration":
        vm_json = json.dumps(_validate_visible_manager_ids(db, getattr(data, "visible_manager_ids", None)))
    admin_notify_json = None
    admin_access_json = None
    if data.role == "admin":
        admin_notify_json = json.dumps(_validate_notify_manager_ids(db, getattr(data, "admin_telegram_notify_manager_ids", None) or []))
        home = get_request_company()
        create_unset = data.model_dump(exclude_unset=True)
        raw_slugs = getattr(data, "admin_accessible_company_slugs", None)
        if "admin_accessible_company_slugs" not in create_unset:
            admin_access_json = _encode_admin_accessible_company_slugs([home], home)
        elif raw_slugs is None:
            admin_access_json = None
        else:
            admin_access_json = _encode_admin_accessible_company_slugs(raw_slugs, home)
    pd = None
    if data.role == "employee" and getattr(data, "payment_details", None):
        pd = str(data.payment_details).strip() or None
    mca = bool(getattr(data, "multi_company_access", False)) if data.role == "employee" else False
    ad_budget = bool(getattr(data, "is_ad_budget_employee", False)) if data.role == "employee" else False
    user = User(
        company_slug=get_request_company(),
        name=data.name,
        email=email_norm,
        role=data.role,
        telegram_id=data.telegram_id,
        telegram_chat_id=data.telegram_chat_id,
        telegram_username=data.telegram_username,
        is_active=data.is_active,
        web_access=data.web_access,
        can_view_subscriptions=bool(getattr(data, "can_view_subscriptions", False)) if data.role == "administration" else False,
        can_view_accesses=bool(getattr(data, "can_view_accesses", False)) if data.role == "administration" else False,
        can_enter_cash_flow=bool(getattr(data, "can_enter_cash_flow", False)) if data.role == "administration" else False,
        see_all_partners=data.see_all_partners if data.role == "manager" else False,
        visible_manager_ids=vm_json,
        payment_details=pd,
        multi_company_access=mca,
        is_ad_budget_employee=ad_budget,
        admin_telegram_notify_all=bool(getattr(data, "admin_telegram_notify_all", False)) if data.role == "admin" else False,
        admin_telegram_notify_manager_ids=admin_notify_json if data.role == "admin" else None,
        admin_accessible_company_slugs=admin_access_json if data.role == "admin" else None,
        hashed_password=get_password_hash(plain),
    )
    moved_username = _transfer_telegram_chat_id(db, user, data.telegram_chat_id)
    user.telegram_chat_id = int(data.telegram_chat_id) if data.telegram_chat_id is not None else None
    user.telegram_username = _normalize_telegram_username(data.telegram_username) or moved_username
    db.add(user)
    db.commit()
    db.refresh(user)
    from app.services.feed_events import emit_user_created
    emit_user_created(user.id, user.name, user.email)
    return user


def _apply_update(user: User, data: UserUpdate):
    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "visible_manager_ids":
            continue
        if field == "admin_telegram_notify_manager_ids":
            continue
        if field == "admin_accessible_company_slugs":
            continue
        if field == "admin_telegram_notify_all":
            continue
        if field == "can_enter_cash_flow":
            continue
        if field in ("telegram_chat_id", "telegram_username"):
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
        elif field == "payment_details":
            nv = None if value is None else (str(value).strip() or None)
            ov = (user.payment_details or "").strip() or None
            user.payment_details = nv
            if user.role == "employee" and nv != ov:
                user.payment_details_updated_at = datetime.now(timezone.utc)
        elif field == "multi_company_access":
            if user.role == "employee":
                user.multi_company_access = bool(value)
        elif field == "is_ad_budget_employee":
            if user.role == "employee":
                user.is_ad_budget_employee = bool(value)
        else:
            setattr(user, field, value)


def _sync_telegram_binding(user: User, data: UserUpdate, db: Session) -> None:
    patch = data.model_dump(exclude_unset=True)
    has_chat = "telegram_chat_id" in patch
    has_username = "telegram_username" in patch
    if not has_chat and not has_username:
        return

    moved_username: Optional[str] = None
    if has_chat:
        chat_id = patch.get("telegram_chat_id")
        if chat_id is None:
            user.telegram_chat_id = None
        else:
            moved_username = _transfer_telegram_chat_id(db, user, int(chat_id))
            user.telegram_chat_id = int(chat_id)

    if has_username:
        user.telegram_username = _normalize_telegram_username(patch.get("telegram_username"))
    elif moved_username and not user.telegram_username:
        user.telegram_username = moved_username


def _sync_visible_managers_after_user_update(db: Session, user: User, data: UserUpdate) -> None:
    from app.core.access import parse_visible_manager_ids

    if data.role is not None and data.role != "administration":
        user.visible_manager_ids = None
        user.can_view_subscriptions = False
        user.can_view_accesses = False
        user.can_enter_cash_flow = False
    if data.visible_manager_ids is not None:
        if user.role != "administration":
            raise HTTPException(status_code=400, detail="Список менеджеров задаётся только для роли «Администрация»")
        user.visible_manager_ids = json.dumps(_validate_visible_manager_ids(db, data.visible_manager_ids))
    if user.role == "administration" and not parse_visible_manager_ids(user):
        raise HTTPException(status_code=400, detail="Укажите хотя бы одного менеджера для роли «Администрация»")
    if user.role != "administration":
        user.can_view_subscriptions = False
        user.can_view_accesses = False
        user.can_enter_cash_flow = False
    if data.role is not None and data.role != "employee":
        user.payment_details = None
        user.multi_company_access = False
        user.is_ad_budget_employee = False
    if data.role is not None and data.role != "admin":
        user.admin_accessible_company_slugs = None


def _sync_administration_cash_flow_input(db: Session, user: User, data: UserUpdate) -> None:
    if user.role != "administration":
        user.can_enter_cash_flow = False
        return
    if data.can_enter_cash_flow is not None:
        user.can_enter_cash_flow = bool(data.can_enter_cash_flow)


def _check_email_change_tenant_unique(db: Session, user: User, data: UserUpdate) -> None:
    em = getattr(data, "email", None)
    if em is None:
        return
    ne = normalize_email(str(em))
    if ne == user.email:
        return
    if (
        db.query(User)
        .filter(
            func.lower(User.email) == ne,
            User.id != user.id,
            User.company_slug == get_request_company(),
        )
        .first()
    ):
        raise HTTPException(status_code=400, detail="Email уже зарегистрирован")


def _sync_admin_company_access(db: Session, user: User, data: UserUpdate, previous_role: Optional[str]) -> None:
    """Только admin: ограничение переключателя организаций; NULL = все (как раньше)."""
    unset = data.model_dump(exclude_unset=True)
    if user.role != "admin":
        user.admin_accessible_company_slugs = None
        return
    home = user.company_slug
    if "admin_accessible_company_slugs" in unset:
        raw = unset.get("admin_accessible_company_slugs")
        if raw is None:
            user.admin_accessible_company_slugs = None
        elif not isinstance(raw, list):
            raise HTTPException(status_code=400, detail="admin_accessible_company_slugs: ожидается список slug")
        else:
            user.admin_accessible_company_slugs = _encode_admin_accessible_company_slugs(raw, home)
        return
    if unset.get("role") == "admin" and previous_role != "admin":
        user.admin_accessible_company_slugs = _encode_admin_accessible_company_slugs([home], home)


def _sync_admin_telegram_prefs(db: Session, user: User, data: UserUpdate) -> None:
    if user.role != "admin":
        user.admin_telegram_notify_all = False
        user.admin_telegram_notify_manager_ids = None
        return
    if data.admin_telegram_notify_all is not None:
        user.admin_telegram_notify_all = bool(data.admin_telegram_notify_all)
    if data.admin_telegram_notify_manager_ids is not None:
        user.admin_telegram_notify_manager_ids = json.dumps(_validate_notify_manager_ids(db, data.admin_telegram_notify_manager_ids))


@router.put("/{user_id}", response_model=UserOut)
def update_user(user_id: int, data: UserUpdate, db: Session = Depends(get_db), _=Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id, User.company_slug == get_request_company()).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    previous_role = user.role
    _check_email_change_tenant_unique(db, user, data)
    _apply_update(user, data)
    _sync_telegram_binding(user, data, db)
    _sync_visible_managers_after_user_update(db, user, data)
    _sync_administration_cash_flow_input(db, user, data)
    _sync_admin_company_access(db, user, data, previous_role)
    _sync_admin_telegram_prefs(db, user, data)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserOut)
def patch_user(user_id: int, data: UserUpdate, db: Session = Depends(get_db), _=Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id, User.company_slug == get_request_company()).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    previous_role = user.role
    _check_email_change_tenant_unique(db, user, data)
    _apply_update(user, data)
    _sync_telegram_binding(user, data, db)
    _sync_visible_managers_after_user_update(db, user, data)
    _sync_administration_cash_flow_input(db, user, data)
    _sync_admin_company_access(db, user, data, previous_role)
    _sync_admin_telegram_prefs(db, user, data)
    db.commit()
    db.refresh(user)
    return user


@router.get("/{user_id}/assigned-partners")
def get_assigned_partners(user_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id, User.company_slug == get_request_company()).first()
    if not user or user.role != "manager":
        raise HTTPException(status_code=400, detail="Только для менеджеров")
    ids = (
        db.query(Partner.id)
        .filter(
            Partner.manager_id == user_id,
            Partner.is_deleted == False,
            Partner.trashed_at.is_(None),
            Partner.company_slug == get_request_company(),
        )
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
    user = db.query(User).filter(User.id == user_id, User.company_slug == get_request_company()).first()
    if not user or user.role != "manager":
        raise HTTPException(status_code=400, detail="Только для менеджеров")
    db.query(Partner).filter(
        Partner.manager_id == user_id,
        Partner.company_slug == get_request_company(),
    ).update(
        {Partner.manager_id: None}, synchronize_session=False
    )
    for pid in body.partner_ids:
        p = (
            db.query(Partner)
            .filter(
                Partner.id == pid,
                Partner.is_deleted == False,
                Partner.trashed_at.is_(None),
                Partner.company_slug == get_request_company(),
            )
            .first()
        )
        if p:
            p.manager_id = user_id
    db.commit()
    return {"ok": True, "partner_ids": body.partner_ids}


@router.delete("/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id, User.company_slug == get_request_company()).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = False
    db.commit()
    return {"ok": True}


# ── Internal endpoints for bot (no auth required, internal network only) ──────

@router.get("/internal/by-chat/{chat_id}")
def get_user_by_chat(chat_id: int, db: Session = Depends(get_db)):
    user = (
        db.query(User)
        .filter(
            User.telegram_chat_id == chat_id,
            User.is_active == True,
            User.company_slug == get_request_company(),
        )
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": user.id, "name": user.name, "role": user.role, "telegram_chat_id": user.telegram_chat_id}


@router.get("/internal/managers")
def get_managers(db: Session = Depends(get_db)):
    managers = db.query(User).filter(
        User.role.in_(["manager", "admin"]),
        User.is_active == True,
        User.telegram_chat_id.isnot(None),
        User.company_slug == get_request_company(),
    ).all()
    return [{"id": u.id, "name": u.name, "telegram_chat_id": u.telegram_chat_id} for u in managers]


@router.get("/internal/telegram-chat-by-user/{user_id}")
def internal_telegram_chat_by_user(user_id: int, db: Session = Depends(get_db)):
    """Для бота: chat id пользователя с привязанным Telegram (менеджер/админ)."""
    u = db.query(User).filter(
        User.id == user_id,
        User.is_active == True,
        User.telegram_chat_id.isnot(None),
        User.company_slug == get_request_company(),
    ).first()
    if not u:
        raise HTTPException(status_code=404, detail="User or telegram not linked")
    return {"telegram_chat_id": int(u.telegram_chat_id), "name": u.name}


@router.get("/internal/telegram-cc-chats")
def internal_telegram_cc_chats(
    route_manager_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Для бота: chat_id получателей копий переписки менеджер–бухгалтерия (админ по настройкам + администрация)."""
    from app.services.telegram_cc import collect_telegram_cc_chat_ids

    return {"chat_ids": collect_telegram_cc_chat_ids(db, route_manager_id)}


@router.get("/internal/accountants")
def internal_accountants(db: Session = Depends(get_db)):
    """Активные бухгалтеры с Telegram — для пересылки сообщений из бота."""
    rows = (
        db.query(User)
        .filter(
            User.role == "accountant",
            User.is_active == True,
            User.telegram_chat_id.isnot(None),
            User.company_slug == get_request_company(),
        )
        .order_by(User.id.asc())
        .all()
    )
    return [
        {"id": u.id, "name": u.name, "telegram_chat_id": int(u.telegram_chat_id)}
        for u in rows
    ]


@router.get("/internal/administration")
def internal_administration(db: Session = Depends(get_db)):
    """Активные пользователи role=administration с Telegram — получатели команд /pay из бота."""
    rows = (
        db.query(User)
        .filter(
            User.role == "administration",
            User.is_active == True,
            User.telegram_chat_id.isnot(None),
            User.company_slug == get_request_company(),
        )
        .order_by(User.id.asc())
        .all()
    )
    return [
        {"id": u.id, "name": u.name, "telegram_chat_id": int(u.telegram_chat_id)}
        for u in rows
    ]


@router.get("/internal/administration-status")
def internal_administration_status(db: Session = Depends(get_db)):
    """Для диагностики бота: все активные administration текущей компании, даже без Chat ID."""
    rows = (
        db.query(User)
        .filter(
            User.role == "administration",
            User.is_active == True,
            User.company_slug == get_request_company(),
        )
        .order_by(User.id.asc())
        .all()
    )
    return [
        {
            "id": u.id,
            "name": u.name,
            "telegram_chat_id": int(u.telegram_chat_id) if u.telegram_chat_id is not None else None,
            "telegram_username": u.telegram_username,
            "has_telegram_chat": bool(u.telegram_chat_id),
        }
        for u in rows
    ]


@router.post("/internal/telegram-dividend")
def internal_telegram_dividend(
    body: InternalTelegramDividendIn,
    db: Session = Depends(get_db),
    _auth: bool = Depends(_verify_internal_secret),
):
    """Для бота: фиксирует изъятие прибыли через команду /d как расход в ДДС."""
    user = (
        db.query(User)
        .filter(
            User.telegram_chat_id == body.chat_id,
            User.is_active == True,
            User.company_slug == get_request_company(),
        )
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role not in ("admin", "financier"):
        raise HTTPException(status_code=403, detail="Команда /d доступна только администратору или финансисту")

    entry_date = body.entry_date or datetime.now(timezone.utc).date()
    period_month = f"{entry_date.year:04d}-{entry_date.month:02d}"
    note = (body.note or "").strip()
    note_prefix = "Добавлено из Telegram командой /d"
    if note:
        note = f"{note_prefix}. {note}"
    else:
        note = note_prefix

    row = CashFlowEntry(
        company_slug=get_request_company(),
        period_month=period_month,
        entry_date=entry_date,
        direction="expense",
        label="Изъятие прибыли (/d)",
        amount_uzs=body.amount_uzs,
        amount_usd=body.amount_usd,
        apply_fx_to_uzs=False,
        payment_method=body.payment_method,
        flow_category="dividends",
        recipient=user.name,
        payment_id=None,
        notes=note,
        template_line_id=None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "ok": True,
        "entry_id": row.id,
        "period_month": row.period_month,
        "entry_date": str(row.entry_date) if row.entry_date else None,
        "label": row.label,
        "flow_category": row.flow_category,
        "amount_uzs": str(row.amount_uzs),
        "amount_usd": str(row.amount_usd),
    }
