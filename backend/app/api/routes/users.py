import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from app.core.companies import normalize_company_slug
from app.db.database import get_db, get_request_company, is_registered_company_slug
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
        if field == "admin_telegram_notify_manager_ids":
            continue
        if field == "admin_accessible_company_slugs":
            continue
        if field == "admin_telegram_notify_all":
            continue
        if field == "can_enter_cash_flow":
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
