"""
Напоминания по реестру подписок: Telegram админам и роли «Администрация» за 1–2 дня до срока (календарные дни, Asia/Tashkent).
"""
from __future__ import annotations

import calendar
import html
import logging
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import List, Optional
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.database import get_request_company
from app.models.subscription_item import SubscriptionItem
from app.models.user import User

logger = logging.getLogger(__name__)
TZ = ZoneInfo("Asia/Tashkent")


def _active_subscription_filter():
    """Неактивные строки не переносим по периоду и не дёргаем в Telegram."""
    return or_(SubscriptionItem.status == "active", SubscriptionItem.status.is_(None))


def _add_months_local(dt_utc: datetime, months_delta: int) -> datetime:
    """Сохраняет локальное время в Ташкенте, сдвигает календарный месяц."""
    loc = dt_utc.astimezone(TZ)
    y, m = loc.year, loc.month + months_delta
    while m > 12:
        m -= 12
        y += 1
    while m < 1:
        m += 12
        y -= 1
    last = calendar.monthrange(y, m)[1]
    d = min(loc.day, last)
    new_loc = loc.replace(year=y, month=m, day=d)
    return new_loc.astimezone(timezone.utc)


def subscription_reminder_recipient_chat_ids(db: Session) -> List[int]:
    rows = (
        db.query(User.telegram_chat_id)
        .filter(
            User.role.in_(("admin", "administration")),
            User.is_active == True,
            User.telegram_chat_id.isnot(None),
            User.company_slug == get_request_company(),
        )
        .all()
    )
    ids = sorted({int(r[0]) for r in rows if r[0] is not None})
    if ids:
        return ids
    if settings.ADMIN_TELEGRAM_CHAT_ID:
        return [int(settings.ADMIN_TELEGRAM_CHAT_ID)]
    return []


def _send_plain(chat_id: int, text: str) -> bool:
    if not settings.BOT_TOKEN:
        return False
    url = f"https://api.telegram.org/bot{settings.BOT_TOKEN}/sendMessage"
    try:
        r = httpx.post(
            url,
            json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
            timeout=20,
        )
        if r.status_code != 200:
            logger.error("subscription_reminder TG %s: %s", r.status_code, r.text[:200])
            return False
        return True
    except Exception as e:
        logger.exception("subscription_reminder TG send failed: %s", e)
        return False


def _advance_overdue_deadlines(db: Session, now_utc: datetime) -> int:
    """Переносит next_deadline_at для monthly/yearly, если срок уже прошёл."""
    changed = 0
    q = (
        db.query(SubscriptionItem)
        .filter(
            SubscriptionItem.next_deadline_at.isnot(None),
            SubscriptionItem.recurrence.in_(("monthly", "yearly")),
            SubscriptionItem.company_slug == get_request_company(),
            _active_subscription_filter(),
        )
        .all()
    )
    for it in q:
        d = it.next_deadline_at
        if d is None:
            continue
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
            it.next_deadline_at = d
        if now_utc <= d:
            continue
        steps = 0
        while d < now_utc and steps < 36:
            d = _add_months_local(d, 1 if it.recurrence == "monthly" else 12)
            steps += 1
        it.next_deadline_at = d
        it.reminder_sent_for_deadline_at = None
        if it.next_deadline_at:
            it.next_due_date = it.next_deadline_at.astimezone(TZ).date()
        changed += 1
    if changed:
        db.commit()
    return changed


def _days_until_deadline_today(deadline_utc: datetime, today_tashkent: date) -> int:
    dl = deadline_utc.astimezone(TZ).date()
    return (dl - today_tashkent).days


def _utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def run_subscription_reminders(db: Session, now_utc: Optional[datetime] = None) -> dict:
    """
    Один прогон: обновить просроченные периоды, разослать напоминания.
    Вызывать из планировщика раз в сутки (утром по Ташкенту).
    """
    if now_utc is None:
        now_utc = datetime.now(timezone.utc)
    today_tk = now_utc.astimezone(TZ).date()

    advanced = _advance_overdue_deadlines(db, now_utc)

    recipients = subscription_reminder_recipient_chat_ids(db)
    if not recipients:
        return {"ok": False, "error": "no_recipients", "advanced": advanced, "sent": 0}

    if not settings.BOT_TOKEN:
        return {"ok": False, "error": "no_bot_token", "advanced": advanced, "sent": 0}

    items = (
        db.query(SubscriptionItem)
        .filter(
            SubscriptionItem.next_deadline_at.isnot(None),
            SubscriptionItem.reminder_days_before.in_((1, 2)),
            SubscriptionItem.company_slug == get_request_company(),
            _active_subscription_filter(),
        )
        .all()
    )

    sent = 0
    for it in items:
        dl = it.next_deadline_at
        if dl is None:
            continue
        if dl.tzinfo is None:
            dl = dl.replace(tzinfo=timezone.utc)
        days_left = _days_until_deadline_today(dl, today_tk)
        if days_left < 1 or days_left > it.reminder_days_before:
            continue
        prev = it.reminder_sent_for_deadline_at
        if prev is not None and _utc(prev) == _utc(dl):
            continue

        amt = it.amount
        amt_s = ""
        if amt is not None:
            a = Decimal(str(amt))
            if it.currency == "UZS":
                amt_s = f"{a:,.0f} сум".replace(",", " ")
            else:
                amt_s = f"${a:,.2f}"

        cat_ru = {"household": "Бытовые", "phones": "Номера", "services": "Подписки"}.get(it.category, it.category)
        phone_s = f"\n📱 {html.escape(it.phone_number)}" if it.phone_number else ""
        rec_ru = {"once": "разово", "monthly": "ежемесячно", "yearly": "ежегодно"}.get(it.recurrence or "once", it.recurrence)
        when = dl.astimezone(TZ).strftime("%d.%m.%Y %H:%M") + " (Ташкент)"
        extras = []
        if it.tag:
            extras.append(f"Tag: {html.escape(it.tag)}")
        if it.payer_code:
            extras.append(f"Кто платит: {html.escape(it.payer_code)}")
        if it.payment_method:
            extras.append(f"Вид оплаты: {html.escape(it.payment_method)}")
        extra_block = ("\n" + "\n".join(extras)) if extras else ""

        text = (
            f"🔔 <b>Подписка / регулярный платёж</b>\n"
            f"Категория: {cat_ru}\n"
            f"Сервис / объект: <b>{html.escape(it.name)}</b>{phone_s}\n"
            f"Сумма: {amt_s or '—'}\n"
            f"Периодичность: {rec_ru}\n"
            f"Срок оплаты: <b>{when}</b>\n"
            f"Осталось дней: {days_left}"
            f"{extra_block}\n"
            f"<i>EnterDebt — напоминание за {it.reminder_days_before} дн. до срока</i>"
        )

        ok_any = False
        for cid in recipients:
            if _send_plain(cid, text):
                ok_any = True
        if ok_any:
            it.reminder_sent_for_deadline_at = dl
            sent += 1

    if sent:
        db.commit()

    return {"ok": True, "advanced": advanced, "sent": sent, "recipients": len(recipients)}


def sync_next_due_date_from_deadline(row: SubscriptionItem) -> None:
    if row.next_deadline_at is None:
        return
    d = row.next_deadline_at
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
        row.next_deadline_at = d
    row.next_due_date = d.astimezone(TZ).date()
