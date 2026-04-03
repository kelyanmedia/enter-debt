import httpx
import logging
from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from datetime import datetime, date, timezone, timedelta
from decimal import Decimal
from calendar import monthrange

from app.db.database import get_db
from app.models.payment import Payment, PaymentMonth
from app.models.partner import Partner
from app.models.user import User
from app.schemas.schemas import PaymentMonthConfirmIn, PaymentMonthCreate, PaymentMonthOut
from app.core.security import get_current_user, require_manager_or_admin
from app.core.access import assert_payment_access
from app.core.config import settings
from app.api.routes.payments import _require_payment_not_trashed
from app.services.telegram_cc import collect_telegram_cc_chat_ids

router = APIRouter(prefix="/api/payments", tags=["payment-months"])

logger = logging.getLogger(__name__)


async def _send_tg(chat_id: str, text: str, reply_markup: Optional[dict] = None):
    if not settings.BOT_TOKEN:
        return
    url = f"https://api.telegram.org/bot{settings.BOT_TOKEN}/sendMessage"
    payload: dict = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(url, json=payload)
    except Exception as e:
        logger.warning(f"TG notify failed: {e}")


async def _send_telegram_cc(db: Session, route_manager_id: Optional[int], text: str, reply_markup: Optional[dict] = None):
    prefix = "📨 <i>Копия (контроль)</i>\n\n"
    for cid in collect_telegram_cc_chat_ids(db, route_manager_id):
        await _send_tg(str(cid), prefix + text, reply_markup=reply_markup)


def resolve_payment_month_due_date(month_str: str, due_date_in: Optional[date], payment: Payment) -> date:
    """Срок оплаты строки месяца: явная дата или день из договора + месяц, иначе последний день месяца услуги."""
    if due_date_in:
        return due_date_in
    try:
        y, m = month_str.split("-")
        yi, mi = int(y), int(m)
    except Exception:
        raise HTTPException(status_code=400, detail="Неверный формат месяца (нужно YYYY-MM)")
    last_d = monthrange(yi, mi)[1]
    if payment.day_of_month:
        d = min(int(payment.day_of_month), last_d)
        return date(yi, mi, d)
    return date(yi, mi, last_d)


def _effective_month_amount(pm_amount: Optional[Decimal], payment_amount) -> Decimal:
    if pm_amount is not None:
        return Decimal(str(pm_amount))
    return Decimal(str(payment_amount))


def _sum_month_lines_amounts(db: Session, payment_id: int, payment: Payment) -> Decimal:
    rows = db.query(PaymentMonth).filter(PaymentMonth.payment_id == payment_id).all()
    return sum(_effective_month_amount(r.amount, payment.amount) for r in rows)


def _month_label(month_str: str) -> str:
    """Convert YYYY-MM to human label like 'Март 2026'."""
    months_ru = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
                 "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]
    try:
        y, m = month_str.split("-")
        return f"{months_ru[int(m) - 1]} {y}"
    except Exception:
        return month_str


def _next_calendar_month(ym: str) -> str:
    parts = (ym or "").strip().split("-")
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail="Неверный формат месяца (нужно YYYY-MM)")
    try:
        y, mo = int(parts[0]), int(parts[1])
    except ValueError:
        raise HTTPException(status_code=400, detail="Неверный формат месяца (нужно YYYY-MM)")
    if mo < 1 or mo > 12:
        raise HTTPException(status_code=400, detail="Неверный месяц в периоде")
    mo += 1
    if mo > 12:
        mo = 1
        y += 1
    return f"{y}-{mo:02d}"


def _next_hosting_year_month(ym: str) -> str:
    """Следующий годовой период: тот же месяц, +1 год (хостинг/домен)."""
    parts = (ym or "").strip().split("-")
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail="Неверный формат месяца (нужно YYYY-MM)")
    try:
        y, mo = int(parts[0]), int(parts[1])
    except ValueError:
        raise HTTPException(status_code=400, detail="Неверный формат месяца (нужно YYYY-MM)")
    if mo < 1 or mo > 12:
        raise HTTPException(status_code=400, detail="Неверный месяц в периоде")
    return f"{y + 1}-{mo:02d}"


@router.get("/{payment_id}/months", response_model=List[PaymentMonthOut])
def list_months(
    payment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    p = _require_payment_not_trashed(db.query(Payment).filter(Payment.id == payment_id).first())
    assert_payment_access(db, current_user, p)
    return (
        db.query(PaymentMonth)
        .filter(PaymentMonth.payment_id == payment_id)
        .order_by(PaymentMonth.month, PaymentMonth.id)
        .all()
    )


@router.post("/{payment_id}/months", response_model=PaymentMonthOut)
def add_month(
    payment_id: int,
    data: PaymentMonthCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    p = _require_payment_not_trashed(db.query(Payment).filter(Payment.id == payment_id).first())
    assert_payment_access(db, current_user, p)

    new_amt = _effective_month_amount(data.amount, p.amount)
    existing_sum = _sum_month_lines_amounts(db, payment_id, p)
    contract_amt = Decimal(str(p.amount)).quantize(Decimal("0.01"))
    if (existing_sum + new_amt).quantize(Decimal("0.01")) > contract_amt:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Сумма по строкам месяцев ({existing_sum + new_amt} сум) не может превышать сумму договора "
                f"({contract_amt} сум). Укажите меньшие суммы по месяцам или увеличьте сумму проекта."
            ),
        )

    due = resolve_payment_month_due_date(data.month, data.due_date, p)
    try:
        pm = PaymentMonth(
            payment_id=payment_id,
            month=data.month,
            due_date=due,
            amount=data.amount,
            description=data.description,
            note=data.note,
            status="pending",
        )
        db.add(pm)
        db.commit()
        db.refresh(pm)
        return pm
    except Exception as e:
        db.rollback()
        logger.error(f"add_month error payment_id={payment_id} month={data.month}: {e}")
        raise HTTPException(status_code=500, detail=f"Ошибка базы данных: {str(e)}")


@router.post("/{payment_id}/months/{month_id}/duplicate-next", response_model=PaymentMonthOut)
def duplicate_month_to_next_month(
    payment_id: int,
    month_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    """
    Копия строки графика: обычно — следующий календарный месяц; для хостинга/домена — тот же месяц через год.
    Та же сумма, новое описание с меткой периода, срок оплаты по правилам договора; акт и оплата сброшены.
    """
    p = _require_payment_not_trashed(db.query(Payment).filter(Payment.id == payment_id).first())
    assert_payment_access(db, current_user, p)
    pm = db.query(PaymentMonth).filter(
        PaymentMonth.id == month_id,
        PaymentMonth.payment_id == payment_id,
    ).first()
    if not pm:
        raise HTTPException(status_code=404, detail="Month not found")

    nxt = _next_hosting_year_month(pm.month) if p.project_category == "hosting_domain" else _next_calendar_month(pm.month)

    new_amt = _effective_month_amount(pm.amount, p.amount)
    existing_sum = _sum_month_lines_amounts(db, payment_id, p)
    contract_amt = Decimal(str(p.amount)).quantize(Decimal("0.01"))
    if (existing_sum + new_amt).quantize(Decimal("0.01")) > contract_amt:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Сумма по строкам месяцев ({existing_sum + new_amt} сум) не может превышать сумму договора "
                f"({contract_amt} сум). Увеличьте сумму проекта или уменьшите суммы по месяцам."
            ),
        )

    due = resolve_payment_month_due_date(nxt, None, p)
    desc = f"{(p.description or '').strip()} {_month_label(nxt)} Акт/СФ".strip()

    try:
        new_pm = PaymentMonth(
            payment_id=payment_id,
            month=nxt,
            due_date=due,
            amount=pm.amount,
            description=desc,
            note=None,
            status="pending",
            act_issued=False,
            act_issued_at=None,
            paid_at=None,
            confirmed_by=None,
        )
        db.add(new_pm)
        db.commit()
        db.refresh(new_pm)
        return new_pm
    except Exception as e:
        db.rollback()
        logger.error(f"duplicate_month payment_id={payment_id} month_id={month_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Ошибка базы данных: {str(e)}")


def _payments_panel_url() -> str:
    return f"{settings.APP_PUBLIC_URL.rstrip('/')}/payments"


def _accounting_telegram_route_user_id(actor: User, partner: Optional[Partner]) -> Optional[int]:
    """
    Кому бот перешлёт файл от бухгалтерии (ответом на пуш):
    если действие сделал менеджер — он; иначе закреплённый за партнёром менеджер (админ/бухгалтерия).
    """
    if actor.role == "manager":
        return actor.id
    if partner and partner.manager_id:
        return partner.manager_id
    return None


def _accounting_reply_footer(route_user_id: Optional[int]) -> str:
    if route_user_id:
        return (
            "\n\n<i>Ответьте <b>на это сообщение</b> (кнопка «Ответить»): "
            "файлом — Акт/СФ, или текстом — уйдёт менеджеру по этому пушу.</i>"
            f"\n<code>ed_route_user_id:{route_user_id}</code>"
        )
    return (
        "\n\n<i>Ответьте <b>на это сообщение</b> файлом или текстом. Закреплённого менеджера нет — "
        "сообщение уйдёт <b>всем</b> менеджерам с привязанным Telegram.</i>"
    )


@router.post("/{payment_id}/months/{month_id}/mark-act", response_model=PaymentMonthOut)
async def mark_act_issued(
    payment_id: int,
    month_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    """Фиксация «Акт выставлен» — независимо от оплаты. Уведомление бухгалтерии: Акт + кнопка «Добавить»."""
    pay = _require_payment_not_trashed(db.query(Payment).filter(Payment.id == payment_id).first())
    assert_payment_access(db, current_user, pay)
    pm = db.query(PaymentMonth).filter(
        PaymentMonth.id == month_id,
        PaymentMonth.payment_id == payment_id,
    ).first()
    if not pm:
        raise HTTPException(status_code=404, detail="Month not found")

    already = bool(pm.act_issued)
    if not already:
        pm.act_issued = True
        pm.act_issued_at = datetime.utcnow()
        db.commit()
        db.refresh(pm)
    else:
        db.refresh(pm)

    payment = _require_payment_not_trashed(
        db.query(Payment)
        .options(joinedload(Payment.partner).joinedload(Partner.manager))
        .filter(Payment.id == payment_id)
        .first()
    )

    if payment.notify_accounting and not already:
        amount_val = pm.amount or payment.amount
        month_label = _month_label(pm.month)
        desc = pm.description or f"{payment.description} {month_label}"
        partner_name = payment.partner.name if payment.partner else "—"
        contract_line = f"\n📄 Договор: {payment.contract_url}" if payment.contract_url else ""
        panel = _payments_panel_url()
        reply_markup = {
            "inline_keyboard": [[{"text": "АКТ/СФ", "url": panel}]],
        }
        route_uid = _accounting_telegram_route_user_id(current_user, payment.partner)
        mgr = payment.partner.manager if payment.partner else None
        mgr_line = f"\n👤 Пуш от: <b>{current_user.name}</b>"
        if mgr and mgr.id != current_user.id:
            mgr_line += f"\n👤 Менеджер партнёра: <b>{mgr.name}</b>"
        footer = _accounting_reply_footer(route_uid)
        accountants = db.query(User).filter(
            User.role == "accountant",
            User.is_active == True,
            User.telegram_chat_id.isnot(None),
        ).all()
        for acc in accountants:
            text = (
                f"📋 <b>Акт</b> — выставьте документы по периоду\n\n"
                f"🏢 Компания: <b>{partner_name}</b>\n"
                f"📋 Описание: <b>{desc}</b>\n"
                f"📅 Месяц: <b>{month_label}</b>\n"
                f"💰 Сумма: <b>{int(amount_val):,} UZS</b>{contract_line}"
                f"{mgr_line}\n\n"
                f"Нажмите «АКТ/СФ», чтобы открыть панель и приложить документы."
                f"{footer}"
            )
            await _send_tg(str(acc.telegram_chat_id), text, reply_markup=reply_markup)
        await _send_telegram_cc(db, route_uid, text, reply_markup=reply_markup)

    return pm


@router.post("/{payment_id}/months/{month_id}/confirm", response_model=PaymentMonthOut)
async def confirm_month(
    payment_id: int,
    month_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    body: PaymentMonthConfirmIn = Body(default_factory=PaymentMonthConfirmIn),
):
    """Только «Оплата прошла» — независимо от акта (предоплата и т.д.)."""
    pay = _require_payment_not_trashed(db.query(Payment).filter(Payment.id == payment_id).first())
    assert_payment_access(db, current_user, pay)
    pm = db.query(PaymentMonth).filter(
        PaymentMonth.id == month_id,
        PaymentMonth.payment_id == payment_id
    ).first()
    if not pm:
        raise HTTPException(status_code=404, detail="Month not found")

    already_paid = pm.status == "paid"
    if not already_paid:
        pm.status = "paid"
        now = datetime.now(timezone.utc)
        if body.paid_at is not None:
            pa = body.paid_at
            if pa.tzinfo is None:
                pa = pa.replace(tzinfo=timezone.utc)
            if pa > now + timedelta(minutes=5):
                raise HTTPException(
                    status_code=400,
                    detail="Дата зачисления не может быть в будущем",
                )
            pm.paid_at = pa
        else:
            pm.paid_at = now
        pm.confirmed_by = current_user.id
        pm.received_payment_method = body.received_payment_method
        db.commit()
        db.refresh(pm)
        # Хостинг/домен: все строки графика оплачены — переносим «следующее продление» на +1 год (без предоплаты лет)
        pay_wm = (
            db.query(Payment)
            .options(joinedload(Payment.months))
            .filter(Payment.id == payment_id)
            .first()
        )
        if (
            pay_wm
            and pay_wm.project_category == "hosting_domain"
            and int(pay_wm.hosting_prepaid_years or 0) == 0
        ):
            months = pay_wm.months or []
            if len(months) > 0 and all(m.status == "paid" for m in months):
                from app.api.routes.payments import add_calendar_years, sync_hosting_fields

                base = pay_wm.hosting_renewal_anchor or pay_wm.deadline_date
                if base:
                    pay_wm.hosting_renewal_anchor = add_calendar_years(base, 1)
                elif pm.due_date:
                    pay_wm.hosting_renewal_anchor = add_calendar_years(pm.due_date, 1)
                else:
                    y, mo = map(int, pm.month.split("-"))
                    ld = monthrange(y, mo)[1]
                    pay_wm.hosting_renewal_anchor = add_calendar_years(date(y, mo, ld), 1)
                sync_hosting_fields(pay_wm)
                db.add(pay_wm)
                db.commit()
    else:
        db.refresh(pm)

    payment = _require_payment_not_trashed(
        db.query(Payment)
        .options(joinedload(Payment.partner).joinedload(Partner.manager))
        .filter(Payment.id == payment_id)
        .first()
    )

    if not already_paid:
        amount_val = pm.amount or payment.amount
        month_label = _month_label(pm.month)
        desc = pm.description or f"{payment.description} {month_label}"
        partner_name = payment.partner.name if payment.partner else "—"
        contract_line = f"\n📄 Договор: {payment.contract_url}" if payment.contract_url else ""

        mgr = payment.partner.manager if payment.partner else None
        if mgr:
            text = (
                f"✅ <b>Оплата прошла</b>\n\n"
                f"🏢 Компания: <b>{partner_name}</b>\n"
                f"📋 Описание: <b>{desc}</b>\n"
                f"📅 Месяц: <b>{month_label}</b>\n"
                f"💰 Сумма: <b>{int(amount_val):,} UZS</b>\n"
                f"👤 Менеджер: {mgr.name}{contract_line}"
            )
            if mgr.telegram_chat_id:
                await _send_tg(str(mgr.telegram_chat_id), text)
            # Копии админам и «Администрации» по настройкам видимости менеджера (без бухгалтерии)
            await _send_telegram_cc(db, mgr.id, text)

        # «Оплата прошла» бухгалтерам в Telegram не отправляем — только менеджер (если есть чат) и CC админ/администрация.

    return pm


@router.delete("/{payment_id}/months/{month_id}")
def delete_month(
    payment_id: int,
    month_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    pay = _require_payment_not_trashed(db.query(Payment).filter(Payment.id == payment_id).first())
    assert_payment_access(db, current_user, pay)
    pm = db.query(PaymentMonth).filter(
        PaymentMonth.id == month_id,
        PaymentMonth.payment_id == payment_id
    ).first()
    if not pm:
        raise HTTPException(status_code=404, detail="Month not found")
    db.delete(pm)
    db.commit()
    return {"ok": True}
