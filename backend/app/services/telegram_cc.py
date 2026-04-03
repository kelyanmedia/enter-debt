"""Копии Telegram-уведомлений по цепочке менеджер–бухгалтерия для администраторов и роли «Администрация»."""
import json
from typing import List, Optional

from sqlalchemy.orm import Session

from app.core.access import parse_visible_manager_ids
from app.models.user import User


def _parse_admin_notify_manager_ids(user: User) -> List[int]:
    raw = getattr(user, "admin_telegram_notify_manager_ids", None) or ""
    if not isinstance(raw, str) or not raw.strip():
        return []
    try:
        return [int(x) for x in json.loads(raw)]
    except (TypeError, ValueError, json.JSONDecodeError):
        return []


def collect_telegram_cc_chat_ids(db: Session, route_manager_id: Optional[int]) -> List[int]:
    """
    Кому дублировать сообщения, привязанные к менеджеру route_manager_id.
    - Администратор: все — если admin_telegram_notify_all; иначе только если id в admin_telegram_notify_manager_ids.
    - Администрация: если route_manager_id в visible_manager_ids.
    Если route_manager_id is None — только админы с admin_telegram_notify_all.
    """
    chats: set[int] = set()

    admins = (
        db.query(User)
        .filter(
            User.role == "admin",
            User.is_active == True,
            User.telegram_chat_id.isnot(None),
        )
        .all()
    )
    for a in admins:
        notify_all = bool(getattr(a, "admin_telegram_notify_all", False))
        mids = _parse_admin_notify_manager_ids(a)
        if notify_all:
            chats.add(int(a.telegram_chat_id))
        elif route_manager_id is not None and route_manager_id in mids:
            chats.add(int(a.telegram_chat_id))

    if route_manager_id is not None:
        for u in (
            db.query(User)
            .filter(
                User.role == "administration",
                User.is_active == True,
                User.telegram_chat_id.isnot(None),
            )
            .all()
        ):
            if route_manager_id in parse_visible_manager_ids(u):
                chats.add(int(u.telegram_chat_id))

    return sorted(chats)
