"""Выборка зафиксированных поступлений за интервал по paid_at (как «Оплаты» / ДДС)."""

from datetime import datetime
from decimal import Decimal
from typing import List

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models.partner import Partner
from app.models.payment import Payment, PaymentMonth
from app.schemas.schemas import ReceivedPaymentRowOut


def fetch_received_payment_rows_range(
    db: Session,
    start_at: datetime,
    end_at: datetime,
) -> List[ReceivedPaymentRowOut]:
    """
    Все поступления с paid_at в [start_at, end_at] (включительно).
    Логика совпадает с GET /dashboard/received-payments за месяц, но по произвольному диапазону.
    """
    out: List[ReceivedPaymentRowOut] = []

    q_months = (
        db.query(PaymentMonth, Payment, Partner)
        .join(Payment, Payment.id == PaymentMonth.payment_id)
        .join(Partner, Partner.id == Payment.partner_id)
        .options(joinedload(PaymentMonth.confirmed_by_user))
        .filter(
            Payment.is_archived == False,
            PaymentMonth.status == "paid",
            PaymentMonth.paid_at.isnot(None),
            PaymentMonth.paid_at >= start_at,
            PaymentMonth.paid_at <= end_at,
        )
        .order_by(Partner.name.asc(), Payment.id.asc(), PaymentMonth.paid_at.desc())
    )
    for pm, pay, part in q_months.all():
        eff = pm.amount if pm.amount is not None else pay.amount
        cu = pm.confirmed_by_user
        line_desc = (pm.description or "").strip() or None
        proj_desc = pay.description
        out.append(
            ReceivedPaymentRowOut(
                kind="month_line",
                paid_at=pm.paid_at,
                amount=eff,
                partner_id=part.id,
                partner_name=part.name,
                payment_id=pay.id,
                project_description=proj_desc,
                service_month=pm.month,
                line_description=line_desc,
                confirmed_by_id=pm.confirmed_by,
                confirmed_by_name=cu.name if cu else None,
            )
        )

    has_months_sq = select(PaymentMonth.payment_id).distinct()
    q_whole = (
        db.query(Payment, Partner)
        .join(Partner, Partner.id == Payment.partner_id)
        .options(joinedload(Payment.confirmed_by_user))
        .filter(
            Payment.is_archived == False,
            Payment.status == "paid",
            Payment.paid_at.isnot(None),
            ~Payment.id.in_(has_months_sq),
            Payment.paid_at >= start_at,
            Payment.paid_at <= end_at,
        )
        .order_by(Partner.name.asc(), Payment.paid_at.desc())
    )
    for pay, part in q_whole.all():
        cu = pay.confirmed_by_user
        out.append(
            ReceivedPaymentRowOut(
                kind="project_whole",
                paid_at=pay.paid_at,
                amount=pay.amount,
                partner_id=part.id,
                partner_name=part.name,
                payment_id=pay.id,
                project_description=pay.description,
                service_month=None,
                line_description=None,
                confirmed_by_id=pay.confirmed_by,
                confirmed_by_name=cu.name if cu else None,
            )
        )

    out.sort(key=lambda r: (r.paid_at.timestamp() if r.paid_at else 0), reverse=True)
    return out
