"""Запрос бухгалтерии на подготовку договора: комментарий + ссылка и/или файл в Telegram."""
import html
import logging
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import get_current_user
from app.db.database import get_db, get_request_company
from app.models.user import User
from app.services.telegram_cc import collect_telegram_cc_chat_ids

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/contract-requests", tags=["contract-requests"])

MAX_FILE_BYTES = 15 * 1024 * 1024  # лимит Telegram ~20MB, берём запас
CAPTION_MAX = 1020  # лимит подписи к документу в Telegram
MSG_MAX = 4000


def _require_contract_request_sender(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in ("admin", "manager", "administration"):
        raise HTTPException(status_code=403, detail="Раздел доступен менеджеру, администрации или администратору")
    return current_user


class ContractNotifyOut(BaseModel):
    ok: bool
    recipients: int
    detail: Optional[str] = None


async def _send_tg_message(chat_id: str, text: str) -> bool:
    if not settings.BOT_TOKEN:
        return False
    url = f"https://api.telegram.org/bot{settings.BOT_TOKEN}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                url,
                json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
            )
        return r.status_code == 200
    except Exception as e:
        logger.warning("TG sendMessage failed: %s", e)
        return False


async def _send_tg_document(chat_id: str, data: bytes, filename: str, caption: str) -> bool:
    if not settings.BOT_TOKEN:
        return False
    url = f"https://api.telegram.org/bot{settings.BOT_TOKEN}/sendDocument"
    safe_name = filename or "document"
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(
                url,
                data={"chat_id": chat_id, "caption": caption, "parse_mode": "HTML"},
                files={"document": (safe_name, data)},
            )
        return r.status_code == 200
    except Exception as e:
        logger.warning("TG sendDocument failed: %s", e)
        return False


def _build_caption(comment: str, contract_url: Optional[str], actor: User, *, for_document: bool = False) -> str:
    c = html.escape(comment.strip())
    lines: List[str] = [
        "📄 <b>Нужно подготовить договор</b>",
        "",
        f"<b>Задача:</b>",
        c,
        "",
        f"👤 <b>От:</b> {html.escape(actor.name)}",
    ]
    if contract_url and str(contract_url).strip():
        u = str(contract_url).strip()
        lines.append("")
        lines.append(f"🔗 <b>Ссылка:</b> {html.escape(u)}")
    text = "\n".join(lines)
    limit = CAPTION_MAX if for_document else MSG_MAX
    if len(text) > limit:
        text = text[: limit - 1] + "…"
    return text


@router.post("/notify-accounting", response_model=ContractNotifyOut)
async def notify_accounting_new_contract(
    comment: str = Form(..., description="Что нужно в договоре: услуга, условия, контрагент и т.д."),
    contract_url: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    actor: User = Depends(_require_contract_request_sender),
):
    c = (comment or "").strip()
    if len(c) < 3:
        raise HTTPException(status_code=400, detail="Опишите задачу (минимум несколько символов)")
    url_part = (contract_url or "").strip() or None
    file_body: Optional[bytes] = None
    file_name: Optional[str] = None
    if file is not None and file.filename:
        file_name = file.filename
        file_body = await file.read()
        if len(file_body) > MAX_FILE_BYTES:
            raise HTTPException(status_code=400, detail="Файл слишком большой (максимум 15 МБ)")
    if not url_part and not file_body:
        raise HTTPException(
            status_code=400,
            detail="Добавьте ссылку на договор или прикрепите файл",
        )

    if not settings.BOT_TOKEN:
        raise HTTPException(status_code=503, detail="BOT_TOKEN не настроен — отправка в Telegram недоступна")

    accountants = (
        db.query(User)
        .filter(
            User.role == "accountant",
            User.is_active == True,
            User.telegram_chat_id.isnot(None),
            User.company_slug == get_request_company(),
        )
        .all()
    )
    if not accountants:
        raise HTTPException(
            status_code=400,
            detail="Нет активных бухгалтеров с привязанным Telegram. Сначала привяжите бота в разделе пользователей.",
        )

    route_mid = actor.id if actor.role in ("manager", "admin") else None
    cc_chats = collect_telegram_cc_chat_ids(db, route_mid)
    cc_prefix = "📨 <i>Копия (контроль)</i>\n\n"

    ok_count = 0
    for acc in accountants:
        cid = str(acc.telegram_chat_id)
        if file_body:
            caption = _build_caption(c, url_part, actor, for_document=True)
            sent = await _send_tg_document(cid, file_body, file_name or "file", caption)
        else:
            full = _build_caption(c, url_part, actor, for_document=False)
            sent = await _send_tg_message(cid, full)
        if sent:
            ok_count += 1

    for cc in cc_chats:
        scid = str(cc)
        if file_body:
            cap = cc_prefix + _build_caption(c, url_part, actor, for_document=True)
            await _send_tg_document(scid, file_body, file_name or "file", cap)
        else:
            full = cc_prefix + _build_caption(c, url_part, actor, for_document=False)
            await _send_tg_message(scid, full)

    if ok_count == 0:
        raise HTTPException(status_code=502, detail="Не удалось доставить сообщение в Telegram (проверьте логи)")

    return ContractNotifyOut(
        ok=True,
        recipients=ok_count,
        detail=None if ok_count == len(accountants) else f"Доставлено {ok_count} из {len(accountants)}",
    )
