"""Напоминания по задачам сделок — push в ленту уведомлений."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import joinedload

from app.db.database import iter_company_sessionmakers, set_company_context, reset_company_context
from app.models.feed_notification import FeedNotification
from app.models.sale_deal_task import SaleDealTask
from app.models.user import User

log = logging.getLogger(__name__)

TASK_TYPE_LABELS = {
    "call": "Связаться",
    "meeting": "Встреча",
    "email": "Email",
    "other": "Задача",
}


def _remind_at(task: SaleDealTask) -> datetime:
    mins = task.remind_minutes_before or 15
    return task.due_at - timedelta(minutes=mins)


def process_sale_deal_task_reminders() -> None:
    now = datetime.now(timezone.utc)
    for slug, SessionLocal in iter_company_sessionmakers():
        token = set_company_context(slug)
        db = SessionLocal()
        try:
            pending = (
                db.query(SaleDealTask)
                .options(joinedload(SaleDealTask.deal))
                .filter(
                    SaleDealTask.company_slug == slug,
                    SaleDealTask.status == "pending",
                    SaleDealTask.reminder_sent_at.is_(None),
                )
                .all()
            )
            for task in pending:
                if not task.due_at:
                    continue
                due = task.due_at
                if due.tzinfo is None:
                    due = due.replace(tzinfo=timezone.utc)
                remind_time = _remind_at(task)
                if remind_time.tzinfo is None:
                    remind_time = remind_time.replace(tzinfo=timezone.utc)
                if now < remind_time:
                    continue

                deal = task.deal
                deal_title = deal.title if deal else f"Сделка #{task.deal_id}"
                label = TASK_TYPE_LABELS.get(task.task_type or "call", "Задача")
                due_fmt = due.strftime("%d.%m.%Y %H:%M")
                assignee = (
                    db.query(User).filter(User.id == task.assigned_user_id).first()
                    if task.assigned_user_id
                    else None
                )
                assignee_name = assignee.name if assignee else "—"

                db.add(
                    FeedNotification(
                        company_slug=slug,
                        kind="sale_task_reminder",
                        title=f"🔔 {label}: {deal_title}",
                        subtitle=f"Через {task.remind_minutes_before} мин · {due_fmt} · {assignee_name}",
                        entity_type="sale_deal_task",
                        entity_id=task.id,
                        partner_id=None,
                    )
                )
                task.reminder_sent_at = now
            db.commit()
        except Exception as exc:
            db.rollback()
            log.warning("sale_deal_task_reminders [%s]: %s", slug, exc)
        finally:
            db.close()
            reset_company_context(token)
