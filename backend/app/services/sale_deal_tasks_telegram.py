"""Telegram push / complete / reschedule для задач сделок (МОП)."""
from __future__ import annotations

import logging
import html
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.models.sale_deal_task import SaleDealTask
from app.models.sale_pipeline import SaleDeal, SaleDealComment
from app.models.user import User

log = logging.getLogger(__name__)
TZ = ZoneInfo("Asia/Tashkent")

TASK_TYPE_LABELS = {
    "call": "Связаться",
    "meeting": "Встреча",
    "email": "Email",
    "other": "Задача",
}


def _send_tg(chat_id: int, text: str, reply_markup: Optional[dict[str, Any]] = None) -> bool:
    if not settings.BOT_TOKEN:
        return False
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
    }
    if reply_markup:
        payload["reply_markup"] = reply_markup
    try:
        r = httpx.post(
            f"https://api.telegram.org/bot{settings.BOT_TOKEN}/sendMessage",
            json=payload,
            timeout=20,
        )
        if r.status_code != 200:
            log.error("sale_deal_task TG %s: %s", r.status_code, r.text[:200])
            return False
        return True
    except Exception as e:
        log.exception("sale_deal_task TG send failed: %s", e)
        return False


def task_label(task: SaleDealTask) -> str:
    return TASK_TYPE_LABELS.get(task.task_type or "call", "Задача")


def build_task_message(task: SaleDealTask, deal: Optional[SaleDeal], *, kind: str = "remind") -> str:
    label = task_label(task)
    deal_title = html.escape((deal.title if deal else None) or f"Сделка #{task.deal_id}")
    due = task.due_at
    if due and due.tzinfo is None:
        due = due.replace(tzinfo=timezone.utc)
    due_local = due.astimezone(TZ) if due else None
    due_fmt = due_local.strftime("%d.%m.%Y %H:%M") if due_local else "—"
    notes = html.escape((task.notes or "").strip())
    head = {
        "remind": "🔔 Напоминание о задаче",
        "updated": "↪️ Срок задачи изменён",
    }.get(kind, "📋 Новая задача")
    lines = [
        f"<b>{head}</b>",
        "",
        f"<b>{label}</b>" + (f" — {notes}" if notes else ""),
        f"Сделка: {deal_title}",
        f"Срок: {due_fmt}",
    ]
    if kind == "remind" and task.remind_minutes_before:
        lines.append(f"Напоминание за {task.remind_minutes_before} мин")
    return "\n".join(lines)


def task_reply_markup(task: SaleDealTask) -> dict[str, Any]:
    suffix = f"{task.id}:{task.company_slug}"
    return {
        "inline_keyboard": [
            [
                {"text": "✅ Выполнить", "callback_data": f"sdt:done:{suffix}"},
            ],
            [
                {"text": "Завтра", "callback_data": f"sdt:tmr:{suffix}"},
                {"text": "Через неделю", "callback_data": f"sdt:wk:{suffix}"},
                {"text": "Через месяц", "callback_data": f"sdt:mo:{suffix}"},
            ],
        ]
    }


def notify_assignee_telegram(
    db: Session,
    task: SaleDealTask,
    *,
    kind: str = "remind",
) -> bool:
    if not task.assigned_user_id:
        return False
    user = db.query(User).filter(User.id == task.assigned_user_id, User.is_active == True).first()
    if not user or not user.telegram_chat_id:
        return False
    deal = task.deal
    if deal is None:
        deal = db.query(SaleDeal).filter(SaleDeal.id == task.deal_id).first()
    try:
        chat_id = int(user.telegram_chat_id)
    except (TypeError, ValueError):
        return False
    text = build_task_message(task, deal, kind=kind)
    return _send_tg(chat_id, text, task_reply_markup(task))


def complete_task(
    db: Session,
    task: SaleDealTask,
    *,
    user_id: Optional[int],
    result: Optional[str] = None,
) -> SaleDealTask:
    if task.status == "done":
        return task
    now = datetime.now(timezone.utc)
    task.status = "done"
    task.completed_at = now
    result_clean = (result or "").strip() or None
    if result_clean:
        task.result = result_clean
    label = task_label(task)
    body = f"Задача выполнена: {label}"
    if task.notes:
        body += f" — {task.notes}"
    if result_clean:
        body += f"\nРезультат: {result_clean}"
    import json

    db.add(
        SaleDealComment(
            company_slug=task.company_slug,
            deal_id=task.deal_id,
            body=body,
            kind="task",
            meta_json=json.dumps({
                "task_id": task.id,
                "task_type": task.task_type,
                "completed": True,
                "result": result_clean,
            }),
            created_by_user_id=user_id,
        )
    )
    db.flush()
    return task


def reschedule_task(
    db: Session,
    task: SaleDealTask,
    *,
    due_at: datetime,
    user_id: Optional[int] = None,
    reset_reminder: bool = True,
) -> SaleDealTask:
    if due_at.tzinfo is None:
        due_at = due_at.replace(tzinfo=timezone.utc)
    task.due_at = due_at
    if reset_reminder:
        task.reminder_sent_at = None
    if task.status == "done":
        task.status = "pending"
        task.completed_at = None
    label = task_label(task)
    due_fmt = due_at.astimezone(TZ).strftime("%d.%m.%Y %H:%M")
    import json

    db.add(
        SaleDealComment(
            company_slug=task.company_slug,
            deal_id=task.deal_id,
            body=f"Задача перенесена: {label} · {due_fmt}",
            kind="task",
            meta_json=json.dumps({
                "task_id": task.id,
                "task_type": task.task_type,
                "due_at": due_at.isoformat(),
                "rescheduled": True,
            }),
            created_by_user_id=user_id,
        )
    )
    db.flush()
    return task


def postpone_delta(kind: str) -> Optional[timedelta]:
    if kind == "tmr":
        return timedelta(days=1)
    if kind == "wk":
        return timedelta(days=7)
    if kind == "mo":
        return timedelta(days=30)
    return None


def load_task(db: Session, task_id: int, company_slug: str) -> Optional[SaleDealTask]:
    return (
        db.query(SaleDealTask)
        .options(joinedload(SaleDealTask.deal), joinedload(SaleDealTask.assigned_user))
        .filter(
            SaleDealTask.id == task_id,
            SaleDealTask.company_slug == company_slug,
        )
        .first()
    )
