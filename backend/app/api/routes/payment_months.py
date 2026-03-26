import httpx
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import and_
from typing import List, Optional
from datetime import datetime

from app.db.database import get_db
from app.models.payment import Payment, PaymentMonth
from app.models.partner import Partner
from app.models.user import User
from app.schemas.schemas import PaymentMonthCreate, PaymentMonthOut
from app.core.security import get_current_user, require_manager_or_admin
from app.core.config import settings

router = APIRouter(prefix="/api/payments", tags=["payment-months"])

logger = logging.getLogger(__name__)


async def _send_tg(chat_id: str, text: str):
    if not settings.BOT_TOKEN:
        return
    url = f"https://api.telegram.org/bot{settings.BOT_TOKEN}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(url, json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"})
    except Exception as e:
        logger.warning(f"TG notify failed: {e}")


def _month_label(month_str: str) -> str:
    """Convert YYYY-MM to human label like 'Март 2026'."""
    months_ru = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
                 "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]
    try:
        y, m = month_str.split("-")
        return f"{months_ru[int(m) - 1]} {y}"
    except Exception:
        return month_str


@router.get("/{payment_id}/months", response_model=List[PaymentMonthOut])
def list_months(
    payment_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user)
):
    p = db.query(Payment).filter(Payment.id == payment_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    return db.query(PaymentMonth).filter(
        PaymentMonth.payment_id == payment_id
    ).order_by(PaymentMonth.month).all()


@router.post("/{payment_id}/months", response_model=PaymentMonthOut)
def add_month(
    payment_id: int,
    data: PaymentMonthCreate,
    db: Session = Depends(get_db),
    _=Depends(require_manager_or_admin)
):
    p = db.query(Payment).filter(Payment.id == payment_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    existing = db.query(PaymentMonth).filter(
        PaymentMonth.payment_id == payment_id,
        PaymentMonth.month == data.month
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Month already exists for this payment")
    pm = PaymentMonth(
        payment_id=payment_id,
        month=data.month,
        amount=data.amount,
        description=data.description,
        note=data.note,
        status="pending"
    )
    db.add(pm)
    db.commit()
    db.refresh(pm)
    return pm


@router.post("/{payment_id}/months/{month_id}/confirm", response_model=PaymentMonthOut)
async def confirm_month(
    payment_id: int,
    month_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    pm = db.query(PaymentMonth).filter(
        PaymentMonth.id == month_id,
        PaymentMonth.payment_id == payment_id
    ).first()
    if not pm:
        raise HTTPException(status_code=404, detail="Month not found")

    pm.status = "paid"
    pm.paid_at = datetime.utcnow()
    db.commit()
    db.refresh(pm)

    # Load payment with all relations for notifications
    payment = db.query(Payment).options(
        joinedload(Payment.partner).joinedload(Partner.manager)
    ).filter(Payment.id == payment_id).first()

    if payment:
        amount_val = pm.amount or payment.amount
        month_label = _month_label(pm.month)
        desc = pm.description or f"{payment.description} {month_label}"
        partner_name = payment.partner.name if payment.partner else "—"
        contract_line = f"\n📄 Договор: {payment.contract_url}" if payment.contract_url else ""

        # Notify manager
        mgr = payment.partner.manager if payment.partner else None
        if mgr and mgr.telegram_chat_id:
            text = (
                f"✅ <b>Оплата подтверждена</b>\n\n"
                f"🏢 Компания: <b>{partner_name}</b>\n"
                f"📋 Описание: <b>{desc}</b>\n"
                f"📅 Месяц: <b>{month_label}</b>\n"
                f"💰 Сумма: <b>{int(amount_val):,} UZS</b>\n"
                f"👤 Менеджер: {mgr.name}{contract_line}"
            )
            await _send_tg(str(mgr.telegram_chat_id), text)

        # Notify accounting if notify_accounting is set
        if payment.notify_accounting:
            accountants = db.query(User).filter(
                User.role == "accountant",
                User.is_active == True,
                User.telegram_chat_id.isnot(None)
            ).all()
            mgr_name = mgr.name if mgr else "—"
            for acc in accountants:
                text = (
                    f"📊 <b>Новый платёж к обработке</b>\n\n"
                    f"🏢 Компания: <b>{partner_name}</b>\n"
                    f"📋 Описание: <b>{desc}</b>\n"
                    f"📅 Месяц: <b>{month_label}</b>\n"
                    f"💰 Сумма: <b>{int(amount_val):,} UZS</b>\n"
                    f"👤 Менеджер: <b>{mgr_name}</b>{contract_line}\n\n"
                    f"📎 Пожалуйста, вышлите Акт и СФ в ответ на это сообщение."
                )
                await _send_tg(str(acc.telegram_chat_id), text)

    return pm


@router.delete("/{payment_id}/months/{month_id}")
def delete_month(
    payment_id: int,
    month_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_manager_or_admin)
):
    pm = db.query(PaymentMonth).filter(
        PaymentMonth.id == month_id,
        PaymentMonth.payment_id == payment_id
    ).first()
    if not pm:
        raise HTTPException(status_code=404, detail="Month not found")
    db.delete(pm)
    db.commit()
    return {"ok": True}
