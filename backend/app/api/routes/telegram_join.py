import json
import logging
import secrets
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.database import get_db, get_request_company
from app.models.user import User
from app.models.telegram_join import TelegramJoinRequest
from app.schemas.schemas import (
    TelegramJoinRequestOut,
    TelegramJoinApprove,
    TelegramJoinInternalRequest,
)
from app.core.security import get_password_hash, normalize_email, require_admin
from app.core.config import settings
from app.api.routes.users import _normalize_telegram_username, _transfer_telegram_chat_id, _validate_visible_manager_ids

router = APIRouter(prefix="/api/telegram-join", tags=["telegram-join"])
logger = logging.getLogger(__name__)


def _verify_internal_secret(
    x_internal_secret: Optional[str] = Header(None, alias="X-Internal-Secret"),
):
    if not settings.INTERNAL_API_SECRET or x_internal_secret != settings.INTERNAL_API_SECRET:
        raise HTTPException(status_code=401, detail="Invalid internal secret")
    return True


def _notify_admin_new_request(
    full_name: Optional[str],
    username: Optional[str],
    chat_id: int,
    resubmit: bool,
) -> None:
    """Пуш админу (ADMIN_TELEGRAM_CHAT_ID), чтобы открыть админку и одобрить заявку."""
    aid = settings.ADMIN_TELEGRAM_CHAT_ID
    if not aid or not settings.BOT_TOKEN:
        return
    panel = settings.APP_PUBLIC_URL.rstrip("/")
    kind = "Повторная заявка" if resubmit else "Новая заявка"
    text = (
        f"🔔 <b>{kind}</b> — EnterDebt бот\n\n"
        f"👤 {full_name or '—'}\n"
        f"@{username or 'нет username'}\n"
        f"🆔 Chat ID: <code>{chat_id}</code>\n\n"
        f"Раздел <b>Пользователи</b> → заявки Telegram → Одобрить.\n"
        f"🌐 <a href=\"{panel}\">{panel}</a>"
    )
    _send_telegram_message(int(aid), text)


def _send_telegram_message(chat_id: int, text: str) -> bool:
    if not settings.BOT_TOKEN:
        logger.warning("BOT_TOKEN not set, cannot send Telegram message")
        return False
    url = f"https://api.telegram.org/bot{settings.BOT_TOKEN}/sendMessage"
    try:
        r = httpx.post(
            url,
            json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
            timeout=15,
        )
        if r.status_code != 200:
            logger.error(f"Telegram API error: {r.status_code} {r.text}")
            return False
        return True
    except Exception as e:
        logger.error(f"Telegram send failed: {e}")
        return False


@router.post("/internal/request")
def bot_create_request(
    data: TelegramJoinInternalRequest,
    db: Session = Depends(get_db),
    _auth: bool = Depends(_verify_internal_secret),
):
    if data.access_password != settings.BOT_ACCESS_PASSWORD:
        raise HTTPException(status_code=403, detail="Неверный пароль доступа")

    existing_user = db.query(User).filter(
        User.telegram_chat_id == data.chat_id,
        User.is_active == True,
        User.company_slug == get_request_company(),
    ).first()
    if existing_user:
        return {"status": "already_registered", "message": "Вы уже зарегистрированы в системе."}

    req = db.query(TelegramJoinRequest).filter(
        TelegramJoinRequest.telegram_chat_id == data.chat_id,
        TelegramJoinRequest.company_slug == get_request_company(),
    ).first()

    if req:
        if req.status == "pending":
            return {"status": "already_pending", "message": "Заявка уже на рассмотрении. Ожидайте."}
        if req.status == "rejected":
            req.status = "pending"
            req.telegram_username = data.username
            req.full_name = data.full_name
            db.commit()
            db.refresh(req)
            _notify_admin_new_request(req.full_name, req.telegram_username, int(req.telegram_chat_id), True)
            return {"status": "resubmitted", "message": "Заявка отправлена повторно."}

    req = TelegramJoinRequest(
        company_slug=get_request_company(),
        telegram_chat_id=data.chat_id,
        telegram_username=data.username,
        full_name=data.full_name,
        status="pending",
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    _notify_admin_new_request(req.full_name, req.telegram_username, int(req.telegram_chat_id), False)
    return {"status": "created", "message": "Заявка отправлена. Администратор подтвердит доступ в ближайшее время."}


@router.get("/pending", response_model=list[TelegramJoinRequestOut])
def list_pending(
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    return (
        db.query(TelegramJoinRequest)
        .filter(
            TelegramJoinRequest.status == "pending",
            TelegramJoinRequest.company_slug == get_request_company(),
        )
        .order_by(TelegramJoinRequest.created_at.asc())
        .all()
    )


def _approve_link_telegram(db: Session, req: TelegramJoinRequest, data: TelegramJoinApprove) -> dict:
    """Привязать chat_id заявки к существующей учётной записи."""
    chat_id = req.telegram_chat_id
    uid = data.link_user_id
    if uid is None:
        raise HTTPException(status_code=400, detail="Не указан пользователь для привязки")

    u = (
        db.query(User)
        .filter(User.id == uid, User.company_slug == get_request_company())
        .first()
    )
    if not u or not u.is_active:
        raise HTTPException(status_code=400, detail="Пользователь не найден или деактивирован")

    expected = {
        "manager": ("manager", "admin"),
        "accountant": ("accountant",),
        "administration": ("administration", "admin"),
    }
    if u.role not in expected[data.role]:
        raise HTTPException(
            status_code=400,
            detail="Роль выбранного пользователя не совпадает с типом одобрения",
        )

    moved_username = _transfer_telegram_chat_id(db, u, int(chat_id))
    u.telegram_chat_id = chat_id
    u.telegram_username = _normalize_telegram_username(req.telegram_username) or moved_username
    if data.name.strip():
        u.name = data.name.strip()

    if data.role == "administration" and u.role == "administration" and data.visible_manager_ids is not None:
        u.visible_manager_ids = json.dumps(_validate_visible_manager_ids(db, data.visible_manager_ids))

    db.delete(req)
    db.commit()
    db.refresh(u)

    url = settings.APP_PUBLIC_URL.rstrip("/")
    if data.role == "manager":
        if u.web_access:
            text = (
                f"✅ <b>Telegram привязан</b>\n\n"
                f"Уведомления по проектам будут приходить в этот чат.\n\n"
                f"🌐 Панель:\n<code>{url}</code>\n"
                f"📧 Логин:\n<code>{u.email}</code>"
            )
        else:
            text = "✅ <b>Telegram привязан</b> к вашей учётной записи."
    elif data.role == "accountant":
        text = (
            f"✅ <b>Telegram привязан</b>\n\n"
            f"Уведомления о платежах и документы будут приходить <b>в этот чат</b>."
        )
    elif u.role == "admin":
        text = (
            f"✅ <b>Telegram привязан</b>\n\n"
            f"Роль: <b>администратор</b> — уведомления и команды бота будут приходить сюда.\n\n"
            f"🌐 Панель:\n<code>{url}</code>\n"
            f"📧 Логин:\n<code>{u.email}</code>"
        )
    else:
        text = (
            f"✅ <b>Telegram привязан</b>\n\n"
            f"Роль: <b>администрация</b> — пуши по выбранным менеджерам и копии переписки с бухгалтерией "
            f"будут приходить сюда.\n\n"
            f"🌐 Панель:\n<code>{url}</code>\n"
            f"📧 Логин:\n<code>{u.email}</code>"
        )
    _send_telegram_message(int(chat_id), text)
    return {"ok": True, "user_id": u.id, "role": data.role, "linked": True}


@router.post("/{request_id}/approve")
def approve_request(
    request_id: int,
    data: TelegramJoinApprove,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    if data.role not in ("manager", "accountant", "administration"):
        raise HTTPException(status_code=400, detail="Роль: manager, accountant или administration")

    req = (
        db.query(TelegramJoinRequest)
        .filter(
            TelegramJoinRequest.id == request_id,
            TelegramJoinRequest.company_slug == get_request_company(),
        )
        .first()
    )
    if not req or req.status != "pending":
        raise HTTPException(status_code=404, detail="Заявка не найдена или уже обработана")

    chat_id = req.telegram_chat_id

    if data.link_user_id is not None:
        return _approve_link_telegram(db, req, data)

    conflict = db.query(User).filter(
        User.telegram_chat_id == chat_id,
        User.is_active == True,
        User.company_slug == get_request_company(),
    ).first()
    if conflict:
        db.delete(req)
        db.commit()
        raise HTTPException(status_code=400, detail="Пользователь с этим Chat ID уже есть")

    if data.role == "manager":
        if not data.email or not data.email.strip():
            raise HTTPException(status_code=400, detail="Для менеджера укажите email")
        email = normalize_email(data.email.strip())
        if (
            db.query(User)
            .filter(
                func.lower(User.email) == email,
                User.company_slug == get_request_company(),
            )
            .first()
        ):
            raise HTTPException(status_code=400, detail="Email уже занят")
        plain_password = secrets.token_urlsafe(10)
        user = User(
            company_slug=get_request_company(),
            name=data.name.strip(),
            email=email,
            role="manager",
            hashed_password=get_password_hash(plain_password),
            telegram_chat_id=chat_id,
            telegram_username=req.telegram_username,
            is_active=True,
            web_access=True,
        )
        db.add(user)
        db.delete(req)
        db.commit()
        db.refresh(user)

        url = settings.APP_PUBLIC_URL.rstrip("/")
        text = (
            f"✅ <b>Заявка одобрена</b>\n\n"
            f"Роль: <b>менеджер</b>\n\n"
            f"🌐 Вход в панель:\n<code>{url}</code>\n\n"
            f"📧 Логин:\n<code>{email}</code>\n\n"
            f"🔑 Пароль:\n<code>{plain_password}</code>\n\n"
            f"Сохраните данные в надёжном месте."
        )
        _send_telegram_message(int(chat_id), text)
        return {"ok": True, "user_id": user.id, "role": "manager"}

    if data.role == "administration":
        if not data.email or not data.email.strip():
            raise HTTPException(status_code=400, detail="Для администрации укажите email (логин в панель)")
        if not data.visible_manager_ids:
            raise HTTPException(
                status_code=400,
                detail="Отметьте хотя бы одного менеджера в зоне видимости (как в карточке пользователя)",
            )
        email = normalize_email(data.email.strip())
        if (
            db.query(User)
            .filter(
                func.lower(User.email) == email,
                User.company_slug == get_request_company(),
            )
            .first()
        ):
            raise HTTPException(status_code=400, detail="Email уже занят")
        vm_json = json.dumps(_validate_visible_manager_ids(db, data.visible_manager_ids))
        plain_password = secrets.token_urlsafe(10)
        user = User(
            company_slug=get_request_company(),
            name=data.name.strip(),
            email=email,
            role="administration",
            hashed_password=get_password_hash(plain_password),
            telegram_chat_id=chat_id,
            telegram_username=req.telegram_username,
            is_active=True,
            web_access=True,
            visible_manager_ids=vm_json,
            can_view_subscriptions=False,
            can_view_accesses=False,
        )
        db.add(user)
        db.delete(req)
        db.commit()
        db.refresh(user)
        url = settings.APP_PUBLIC_URL.rstrip("/")
        text = (
            f"✅ <b>Заявка одобрена</b>\n\n"
            f"Роль: <b>администрация</b>\n\n"
            f"🌐 Вход в панель:\n<code>{url}</code>\n\n"
            f"📧 Логин:\n<code>{email}</code>\n\n"
            f"🔑 Пароль:\n<code>{plain_password}</code>\n\n"
            f"В панели видны партнёры и проекты выбранных менеджеров; в Telegram — копии уведомлений и ответов бухгалтерии по ним."
        )
        _send_telegram_message(int(chat_id), text)
        return {"ok": True, "user_id": user.id, "role": "administration"}

    # accountant — только пуши в Telegram, без веб-доступа (служебный email для БД)
    email = f"tg_buh_{chat_id}@enterdebt.app"

    def _notify_accountant_approved() -> None:
        text = (
            f"✅ <b>Заявка одобрена</b>\n\n"
            f"Роль: <b>бухгалтерия</b>\n\n"
            f"Уведомления о платежах и запросы документов будут приходить <b>в этот чат</b>. "
            f"Вход в веб-панель для этой роли не требуется."
        )
        _send_telegram_message(int(chat_id), text)

    # Уже есть строка с этим chat_id (часто is_active=False после «удаления» в админке)
    u_by_chat = db.query(User).filter(
        User.telegram_chat_id == chat_id,
        User.company_slug == get_request_company(),
    ).first()
    if u_by_chat:
        if u_by_chat.is_active:
            db.delete(req)
            db.commit()
            raise HTTPException(
                status_code=400,
                detail="Пользователь с этим Chat ID уже активен в системе.",
            )
        u_by_chat.name = data.name.strip()
        u_by_chat.email = email
        u_by_chat.role = "accountant"
        u_by_chat.telegram_username = req.telegram_username
        u_by_chat.hashed_password = get_password_hash(secrets.token_urlsafe(16))
        u_by_chat.web_access = False
        u_by_chat.is_active = True
        db.delete(req)
        db.commit()
        db.refresh(u_by_chat)
        _notify_accountant_approved()
        return {"ok": True, "user_id": u_by_chat.id, "role": "accountant"}

    # Служебный email остался от прошлой бухгалтерии, chat_id сняли — повторная заявка
    existing_buh = db.query(User).filter(
        User.email == email,
        User.company_slug == get_request_company(),
    ).first()
    if existing_buh:
        if existing_buh.telegram_chat_id is not None and int(existing_buh.telegram_chat_id) != int(chat_id):
            raise HTTPException(
                status_code=400,
                detail="Учётная запись бухгалтерии с этим email привязана к другому Chat ID.",
            )
        existing_buh.name = data.name.strip()
        existing_buh.telegram_chat_id = chat_id
        existing_buh.telegram_username = req.telegram_username
        existing_buh.role = "accountant"
        existing_buh.web_access = False
        existing_buh.is_active = True
        existing_buh.hashed_password = get_password_hash(secrets.token_urlsafe(16))
        db.delete(req)
        db.commit()
        db.refresh(existing_buh)
        _notify_accountant_approved()
        return {"ok": True, "user_id": existing_buh.id, "role": "accountant"}

    plain_unused = secrets.token_urlsafe(16)
    user = User(
        company_slug=get_request_company(),
        name=data.name.strip(),
        email=email,
        role="accountant",
        hashed_password=get_password_hash(plain_unused),
        telegram_chat_id=chat_id,
        telegram_username=req.telegram_username,
        is_active=True,
        web_access=False,
    )
    db.add(user)
    db.delete(req)
    db.commit()
    db.refresh(user)

    _notify_accountant_approved()
    return {"ok": True, "user_id": user.id, "role": "accountant"}


@router.post("/{request_id}/reject")
def reject_request(
    request_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    req = (
        db.query(TelegramJoinRequest)
        .filter(
            TelegramJoinRequest.id == request_id,
            TelegramJoinRequest.company_slug == get_request_company(),
        )
        .first()
    )
    if not req or req.status != "pending":
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    req.status = "rejected"
    db.commit()

    _send_telegram_message(
        int(req.telegram_chat_id),
        "❌ Ваша заявка отклонена администратором. При необходимости обратитесь к руководству.",
    )
    return {"ok": True}
