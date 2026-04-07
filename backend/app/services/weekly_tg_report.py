"""Еженедельный текстовый отчёт о поступлениях в Telegram (Asia/Tashkent)."""

from __future__ import annotations

import html
import logging
from collections import defaultdict
from datetime import datetime, time, timedelta
from decimal import Decimal
from typing import Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.database import get_request_company
from app.models.user import User
from app.schemas.schemas import ReceivedPaymentRowOut
from app.services.received_cashflow import fetch_received_payment_rows_range

logger = logging.getLogger(__name__)

TZ_TASHKENT = ZoneInfo("Asia/Tashkent")

_MONTHS_RU = (
    "янв.",
    "фев.",
    "мар.",
    "апр.",
    "мая",
    "июн.",
    "июл.",
    "авг.",
    "сен.",
    "окт.",
    "нояб.",
    "дек.",
)


def report_period_tashkent(now: Optional[datetime] = None) -> Tuple[datetime, datetime]:
    """
    Интервал отчёта: с понедельника 00:00 до min(сейчас, пятница 18:00 той же недели), Asia/Tashkent.
    Неделя ISO: понедельник — первый день.
    """
    tz = TZ_TASHKENT
    n = datetime.now(tz) if now is None else now.astimezone(tz)
    d = n.date()
    monday = d - timedelta(days=n.weekday())
    start = datetime.combine(monday, time.min, tzinfo=tz)
    friday_end = datetime.combine(monday + timedelta(days=4), time(18, 0), tzinfo=tz)
    end = min(n, friday_end)
    if end < start:
        end = n
    return start, end


def period_title_ru(start: datetime, end: datetime) -> str:
    def fmt_short(dt: datetime) -> str:
        return f"{dt.day:02d}.{dt.month:02d}.{dt.year}"

    return f"пн {fmt_short(start)} — {fmt_short(end)} ({_MONTHS_RU[end.month - 1]} {end.year}, Ташкент)"


def _fmt_money(x: Decimal) -> str:
    x = Decimal(x).quantize(Decimal("0.01"))
    neg = x < 0
    x = abs(x)
    s = format(x, "f")
    if "." in s:
        ip, fp = s.split(".")
    else:
        ip, fp = s, "00"
    parts = []
    while ip:
        parts.append(ip[-3:])
        ip = ip[:-3]
    spaced = " ".join(reversed(parts))
    out = f"{spaced},{fp}"
    return f"−{out}" if neg else out


def build_weekly_report_messages(rows: List[ReceivedPaymentRowOut], start: datetime, end: datetime) -> Tuple[str, Decimal]:
    """Заголовок + тело; при необходимости разбиение — снаружи по лимиту Telegram."""
    total = sum((Decimal(str(r.amount)) for r in rows), Decimal(0))

    by_project: Dict[Tuple[int, int], dict] = defaultdict(
        lambda: {"partner": "", "desc": "", "sum": Decimal(0), "lines": []}
    )
    for r in rows:
        key = (r.partner_id, r.payment_id)
        cell = by_project[key]
        cell["partner"] = r.partner_name
        cell["desc"] = r.project_description or "—"
        cell["sum"] += Decimal(str(r.amount))
        if r.kind == "month_line" and r.service_month:
            ym = r.service_month
            if len(ym) == 7 and ym[4] == "-":
                try:
                    y, m = int(ym[:4]), int(ym[5:7])
                    sm = f"{_MONTHS_RU[m - 1]} {y}"
                except Exception:
                    sm = ym
            else:
                sm = ym
            line_label = (r.line_description or "").strip() or sm
            cell["lines"].append(f"{line_label}: {_fmt_money(Decimal(str(r.amount)))}")
        else:
            cell["lines"].append(_fmt_money(Decimal(str(r.amount))))

    ordered = sorted(by_project.items(), key=lambda kv: (kv[1]["partner"].lower(), kv[1]["desc"].lower()))

    title = (
        f"📊 <b>Поступления за неделю</b>\n"
        f"{html.escape(period_title_ru(start, end))}\n\n"
        f"<b>Всего:</b> {_fmt_money(total)}"
    )

    if not ordered:
        body = "\n\n<i>За период поступлений нет.</i>"
        return title + body, total

    lines_html: List[str] = ["\n\n<b>По проектам:</b>"]
    n = 0
    for (_, _), cell in ordered:
        n += 1
        p_esc = html.escape(cell["partner"])
        d_esc = html.escape(cell["desc"])
        s_esc = _fmt_money(cell["sum"])
        lines_html.append(f"\n{n}) <b>{p_esc}</b> — {d_esc}: <b>{s_esc}</b>")
        for sub in cell["lines"]:
            if len(cell["lines"]) > 1 or ":" in sub:
                lines_html.append(f"   · {html.escape(sub)}")

    body = "".join(lines_html)
    return title + body, total


def split_telegram_html(text: str, max_len: int = 3800) -> List[str]:
    if len(text) <= max_len:
        return [text]
    chunks: List[str] = []
    rest = text
    while rest:
        if len(rest) <= max_len:
            chunks.append(rest)
            break
        cut = rest.rfind("\n", 0, max_len)
        if cut < max_len // 2:
            cut = max_len
        chunks.append(rest[:cut])
        rest = rest[cut:].lstrip("\n")
    return chunks


def send_telegram_html(chat_id: int, text: str) -> bool:
    if not settings.BOT_TOKEN:
        logger.warning("BOT_TOKEN not set, weekly report not sent")
        return False
    url = f"https://api.telegram.org/bot{settings.BOT_TOKEN}/sendMessage"
    for part in split_telegram_html(text):
        try:
            r = httpx.post(
                url,
                json={"chat_id": chat_id, "text": part, "parse_mode": "HTML"},
                timeout=20,
            )
            if r.status_code != 200:
                logger.error(f"Telegram API error: {r.status_code} {r.text}")
                return False
        except Exception as e:
            logger.exception(f"Telegram send failed: {e}")
            return False
    return True


def admin_report_chat_ids(db: Session) -> List[int]:
    """Все активные админы с привязанным Telegram; иначе дефолт из настроек."""
    rows = (
        db.query(User.telegram_chat_id)
        .filter(
            User.role == "admin",
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


def run_weekly_cash_report(db: Session, now: Optional[datetime] = None) -> dict:
    """
    Собирает отчёт за период report_period_tashkent(now) и шлёт всем админам в Telegram.
    Возвращает служебный dict для логов / API.
    """
    start, end = report_period_tashkent(now)
    rows = fetch_received_payment_rows_range(db, start, end)
    text, total = build_weekly_report_messages(rows, start, end)
    chat_ids = admin_report_chat_ids(db)
    if not chat_ids:
        return {
            "ok": False,
            "error": "no_recipient",
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
            "total": str(total),
            "row_count": len(rows),
        }
    if not settings.BOT_TOKEN:
        return {
            "ok": False,
            "error": "no_bot_token",
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
            "total": str(total),
            "row_count": len(rows),
        }
    ok_any = False
    for cid in chat_ids:
        if send_telegram_html(cid, text):
            ok_any = True
    return {
        "ok": ok_any,
        "sent_to": chat_ids,
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "total": str(total),
        "row_count": len(rows),
        "project_groups": len({(r.partner_id, r.payment_id) for r in rows}),
    }
