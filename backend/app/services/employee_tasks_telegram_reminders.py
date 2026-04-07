"""
Напоминания сотрудникам (роль employee) в Telegram: 26, 28 и 30 числа —
вопрос о внесении задач с кнопками «Да» / «Нет» (обработка нажатий в backend/bot/bot.py).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.database import get_request_company
from app.models.user import User

logger = logging.getLogger(__name__)
TZ = ZoneInfo("Asia/Tashkent")

REMINDER_DAYS = (26, 28, 30)


def _callback_suffix(now_local) -> str:
    return now_local.strftime("%Y%m")


def _send_task_reminder(chat_id: int, text: str, reply_markup: dict[str, Any]) -> bool:
    if not settings.BOT_TOKEN:
        return False
    url = f"https://api.telegram.org/bot{settings.BOT_TOKEN}/sendMessage"
    try:
        r = httpx.post(
            url,
            json={
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "HTML",
                "reply_markup": reply_markup,
            },
            timeout=20,
        )
        if r.status_code != 200:
            logger.error("employee_task_reminder TG %s: %s", r.status_code, r.text[:200])
            return False
        return True
    except Exception as e:
        logger.exception("employee_task_reminder TG send failed: %s", e)
        return False


def run_employee_task_check_reminders(db: Session, now_utc: datetime) -> dict[str, Any]:
    loc = now_utc.astimezone(TZ)
    if loc.day not in REMINDER_DAYS:
        return {"skipped": True, "reason": "not_reminder_day", "local_date": str(loc.date())}

    suffix = _callback_suffix(loc)
    rows = (
        db.query(User)
        .filter(
            User.role == "employee",
            User.is_active == True,
            User.telegram_chat_id.isnot(None),
            User.company_slug == get_request_company(),
        )
        .all()
    )

    body = (
        "📋 <b>EnterDebt</b>\n\n"
        "Вы внесли все задачи в систему?"
    )
    reply_markup = {
        "inline_keyboard": [
            [
                {"text": "Да", "callback_data": f"edtk:y:{suffix}"},
                {"text": "Нет", "callback_data": f"edtk:n:{suffix}"},
            ]
        ]
    }

    sent = 0
    failed = 0
    for u in rows:
        cid = u.telegram_chat_id
        if cid is None:
            continue
        try:
            chat_id = int(cid)
        except (TypeError, ValueError):
            failed += 1
            continue
        if _send_task_reminder(chat_id, body, reply_markup):
            sent += 1
        else:
            failed += 1

    return {
        "local_date": str(loc.date()),
        "suffix": suffix,
        "employees": len(rows),
        "sent": sent,
        "failed": failed,
    }
