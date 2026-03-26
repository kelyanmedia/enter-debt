import logging
import secrets
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.user import User
from app.models.telegram_join import TelegramJoinRequest
from app.schemas.schemas import (
    TelegramJoinRequestOut,
    TelegramJoinApprove,
    TelegramJoinInternalRequest,
)
from app.core.security import get_password_hash, require_admin
from app.core.config import settings

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
    ).first()
    if existing_user:
        return {"status": "already_registered", "message": "Вы уже зарегистрированы в системе."}

    req = db.query(TelegramJoinRequest).filter(
        TelegramJoinRequest.telegram_chat_id == data.chat_id
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
        .filter(TelegramJoinRequest.status == "pending")
        .order_by(TelegramJoinRequest.created_at.asc())
        .all()
    )


@router.post("/{request_id}/approve")
def approve_request(
    request_id: int,
    data: TelegramJoinApprove,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    if data.role not in ("manager", "accountant"):
        raise HTTPException(status_code=400, detail="Роль: manager или accountant")

    req = db.query(TelegramJoinRequest).filter(TelegramJoinRequest.id == request_id).first()
    if not req or req.status != "pending":
        raise HTTPException(status_code=404, detail="Заявка не найдена или уже обработана")

    chat_id = req.telegram_chat_id

    if db.query(User).filter(User.telegram_chat_id == chat_id, User.is_active == True).first():
        db.delete(req)
        db.commit()
        raise HTTPException(status_code=400, detail="Пользователь с этим Chat ID уже есть")

    if data.role == "manager":
        if not data.email or not data.email.strip():
            raise HTTPException(status_code=400, detail="Для менеджера укажите email")
        email = data.email.strip()
        if db.query(User).filter(User.email == email).first():
            raise HTTPException(status_code=400, detail="Email уже занят")
        plain_password = secrets.token_urlsafe(10)
        user = User(
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

    # accountant — только пуши в Telegram, без веб-доступа (служебный email для БД)
    email = f"tg_buh_{chat_id}@enterdebt.app"
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=400, detail="Пользователь бухгалтерии для этого чата уже существует")

    plain_unused = secrets.token_urlsafe(16)
    user = User(
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

    text = (
        f"✅ <b>Заявка одобрена</b>\n\n"
        f"Роль: <b>бухгалтерия</b>\n\n"
        f"Уведомления о платежах и запросы документов будут приходить <b>в этот чат</b>. "
        f"Вход в веб-панель для этой роли не требуется."
    )
    _send_telegram_message(int(chat_id), text)
    return {"ok": True, "user_id": user.id, "role": "accountant"}


@router.post("/{request_id}/reject")
def reject_request(
    request_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    req = db.query(TelegramJoinRequest).filter(TelegramJoinRequest.id == request_id).first()
    if not req or req.status != "pending":
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    req.status = "rejected"
    db.commit()

    _send_telegram_message(
        int(req.telegram_chat_id),
        "❌ Ваша заявка отклонена администратором. При необходимости обратитесь к руководству.",
    )
    return {"ok": True}
