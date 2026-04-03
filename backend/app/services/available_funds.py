"""Сводка «Доступные средства»: оплаты по способу поступления + ручные вклады и корректировки."""

from calendar import monthrange
from datetime import date
from decimal import Decimal
from typing import Optional, Tuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.available_funds_manual import AvailableFundsManual
from app.models.partner import Partner
from app.models.payment import Payment, PaymentMonth
from app.schemas.schemas import AvailableFundsOut


def _split_method_amount(method: Optional[str], amount: Decimal) -> Tuple[Decimal, Decimal]:
    """transfer → счёт; иначе (card, cash, NULL) → карты/прочее."""
    if method == "transfer":
        return amount, Decimal(0)
    return Decimal(0), amount


def _sums_from_payments(db: Session, year: int, month: int) -> Tuple[Decimal, Decimal]:
    """Суммы только из оплат по paid_at за календарный месяц."""
    start_date = date(year, month, 1)
    end_date = date(year, month, monthrange(year, month)[1])
    on_acc = Decimal(0)
    on_cards = Decimal(0)

    q_months = (
        db.query(PaymentMonth, Payment)
        .join(Payment, Payment.id == PaymentMonth.payment_id)
        .join(Partner, Partner.id == Payment.partner_id)
        .filter(
            Payment.is_archived == False,
            Payment.trashed_at.is_(None),
            Partner.trashed_at.is_(None),
            PaymentMonth.status == "paid",
            PaymentMonth.paid_at.isnot(None),
            func.date(PaymentMonth.paid_at) >= start_date,
            func.date(PaymentMonth.paid_at) <= end_date,
        )
    )
    for pm, pay in q_months.all():
        eff = pm.amount if pm.amount is not None else pay.amount
        a, c = _split_method_amount(getattr(pm, "received_payment_method", None), Decimal(str(eff)))
        on_acc += a
        on_cards += c

    has_months_sq = select(PaymentMonth.payment_id).distinct()
    q_whole = (
        db.query(Payment)
        .join(Partner, Partner.id == Payment.partner_id)
        .filter(
            Payment.is_archived == False,
            Payment.trashed_at.is_(None),
            Partner.trashed_at.is_(None),
            Payment.status == "paid",
            Payment.paid_at.isnot(None),
            ~Payment.id.in_(has_months_sq),
            func.date(Payment.paid_at) >= start_date,
            func.date(Payment.paid_at) <= end_date,
        )
    )
    for pay in q_whole.all():
        a, c = _split_method_amount(getattr(pay, "received_payment_method", None), Decimal(str(pay.amount)))
        on_acc += a
        on_cards += c

    return on_acc, on_cards


def available_funds_for_period(db: Session, period_month: str) -> AvailableFundsOut:
    """Итог по месяцу: авто из оплат + ручные доп. на счёт/карты + вклады."""
    y, mo = period_month.split("-")
    yi, mi = int(y), int(mo)
    base_a, base_c = _sums_from_payments(db, yi, mi)
    row = db.query(AvailableFundsManual).filter(AvailableFundsManual.period_month == period_month).first()
    dep = Decimal(str(row.deposits_uzs)) if row else Decimal("0")
    adj_a = Decimal(str(row.adjust_account_uzs)) if row else Decimal("0")
    adj_c = Decimal(str(row.adjust_cards_uzs)) if row else Decimal("0")
    return AvailableFundsOut(
        period_month=period_month,
        on_account_uzs=(base_a + adj_a).quantize(Decimal("0.01")),
        on_cards_uzs=(base_c + adj_c).quantize(Decimal("0.01")),
        deposits_uzs=dep.quantize(Decimal("0.01")),
        from_payments_account_uzs=base_a.quantize(Decimal("0.01")),
        from_payments_cards_uzs=base_c.quantize(Decimal("0.01")),
        adjust_account_uzs=adj_a.quantize(Decimal("0.01")),
        adjust_cards_uzs=adj_c.quantize(Decimal("0.01")),
    )
