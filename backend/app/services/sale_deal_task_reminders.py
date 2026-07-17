"""Напоминания по задачам сделок — лента + Telegram push МОПу."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import joinedload

from app.db.database import iter_company_sessionmakers, set_company_context, reset_company_context
from app.models.feed_notification import FeedNotification
from app.models.sale_deal_task import SaleDealTask
from app.models.user import User
from app.services.sale_deal_tasks_telegram import (
    TASK_TYPE_LABELS,
    notify_assignee_telegram,
)

log = logging.getLogger(__name__)


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
                .options(joinedload(SaleDealTask.deal), joinedload(SaleDealTask.assigned_user))
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
                assignee = task.assigned_user
                if assignee is None and task.assigned_user_id:
                    assignee = db.query(User).filter(User.id == task.assigned_user_id).first()
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
                notify_assignee_telegram(db, task, kind="remind")
                task.reminder_sent_at = now
            db.commit()
        except Exception as exc:
            db.rollback()
            log.warning("sale_deal_task_reminders [%s]: %s", slug, exc)
        finally:
            db.close()
            reset_company_context(token)
