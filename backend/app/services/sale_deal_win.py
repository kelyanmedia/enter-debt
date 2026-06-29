"""Закрытие выигранной CRM-сделки: проект в «Проекты» + комиссия МОП."""
from __future__ import annotations

import json
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import List, Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.database import get_request_company
from app.models.commission import Commission
from app.models.partner import Partner
from app.models.payment import Payment, PaymentMonth
from app.models.sale_pipeline import SaleDeal, SaleDealComment, SalePipelineStage
from app.models.sales_company import SalesCompany
from app.models.user import User
from app.api.routes.payment_months import resolve_payment_month_due_date

_CATEGORY_TO_COMMISSION_TYPE = {
    "seo": "seo",
    "target": "ppc",
    "smm": "ppc",
    "content": "site",
    "personal_brand": "site",
    "events": "site",
    "tech_support": "site",
    "hosting_domain": "site",
    "web": "site",
}


def commission_type_for_category(category: Optional[str], explicit: Optional[str] = None) -> str:
    if explicit in ("site", "seo", "ppc"):
        return explicit
    if category:
        return _CATEGORY_TO_COMMISSION_TYPE.get(category.strip().lower(), "site")
    return "site"


def _validate_percent(pct: Decimal) -> Decimal:
    v = Decimal(str(pct)).quantize(Decimal("0.01"))
    if v < 1 or v > 20:
        raise HTTPException(status_code=400, detail="% комиссии: от 1 до 20")
    return v


def _find_or_create_partner(db: Session, deal: SaleDeal) -> Partner:
    slug = get_request_company()
    name = (deal.company_name or deal.title or "").strip()
    contact = (deal.contact_name or "").strip() or None
    phone = (deal.phone or "").strip() or None
    email = (deal.email or "").strip() or None
    partner_type = "A"

    if deal.sales_company_id:
        sc = (
            db.query(SalesCompany)
            .filter(
                SalesCompany.id == deal.sales_company_id,
                SalesCompany.company_slug == slug,
            )
            .first()
        )
        if sc:
            name = (sc.company_name or name).strip() or name
            contact = contact or (sc.contact_name or sc.lpr_name or "").strip() or None
            phone = phone or (sc.phone or "").strip() or None
            email = email or (sc.email or "").strip() or None
            if sc.client_type in ("A", "B", "C"):
                partner_type = sc.client_type

    if not name:
        raise HTTPException(status_code=400, detail="Укажите название компании в сделке")

    existing = (
        db.query(Partner)
        .filter(
            Partner.company_slug == slug,
            Partner.trashed_at.is_(None),
            func.lower(Partner.name) == name.lower(),
        )
        .first()
    )
    if existing:
        return existing

    partner = Partner(
        company_slug=slug,
        name=name,
        contact_person=contact,
        phone=phone,
        email=email,
        partner_type=partner_type,
        manager_id=None,
        status="active",
        comment=f"Создан из CRM-сделки #{deal.id}",
    )
    db.add(partner)
    db.flush()
    return partner


class ScheduleLine:
    def __init__(self, month: str, amount: Decimal, due_date: Optional[date] = None, description: Optional[str] = None):
        self.month = month
        self.amount = amount
        self.due_date = due_date
        self.description = description


def close_deal_won(
    db: Session,
    deal: SaleDeal,
    actor: User,
    *,
    stage_id: int,
    project_category: str,
    project_type: Optional[str],
    payment_type: str,
    description: str,
    amount: Decimal,
    contract_months: Optional[int],
    day_of_month: Optional[int],
    contract_url: Optional[str],
    production_cost: Decimal,
    manager_percent: Optional[Decimal],
    schedule: List[ScheduleLine],
    first_payment_received: bool,
    received_amount: Optional[Decimal],
    received_amount_on: Optional[date],
    received_payment_method: Optional[str],
) -> tuple[Payment, Commission]:
    if deal.payment_id:
        raise HTTPException(status_code=400, detail="По сделке уже создан проект")

    slug = get_request_company()
    stage = (
        db.query(SalePipelineStage)
        .filter(
            SalePipelineStage.id == stage_id,
            SalePipelineStage.pipeline_id == deal.pipeline_id,
            SalePipelineStage.company_slug == slug,
        )
        .first()
    )
    if not stage or not stage.is_closed_won:
        raise HTTPException(status_code=400, detail="Укажите этап «Успешно закрыта»")

    if not schedule:
        raise HTTPException(status_code=400, detail="Добавьте хотя бы одну строку графика оплат")

    contract_amt = Decimal(str(amount)).quantize(Decimal("0.01"))
    if contract_amt <= 0:
        raise HTTPException(status_code=400, detail="Сумма договора должна быть больше 0")

    schedule_sum = sum(Decimal(str(l.amount)) for l in schedule).quantize(Decimal("0.01"))
    if schedule_sum > contract_amt:
        raise HTTPException(
            status_code=400,
            detail=f"Сумма по графику ({schedule_sum}) не может превышать сумму договора ({contract_amt})",
        )

    mop_id = deal.assigned_user_id or actor.id
    mop = db.query(User).filter(User.id == mop_id, User.company_slug == slug).first()
    if not mop:
        raise HTTPException(status_code=400, detail="Не найден ответственный МОП по сделке")

    if manager_percent is not None:
        pct = _validate_percent(manager_percent)
    elif mop.mop_default_commission_percent is not None:
        pct = _validate_percent(mop.mop_default_commission_percent)
    else:
        pct = Decimal("10")

    partner = _find_or_create_partner(db, deal)
    pay = Payment(
        company_slug=slug,
        partner_id=partner.id,
        payment_type=payment_type,
        description=description.strip(),
        amount=contract_amt,
        contract_months=contract_months,
        day_of_month=day_of_month,
        contract_url=(contract_url or "").strip() or None,
        project_category=(project_category or "").strip() or None,
        notify_accounting=True,
        status="pending",
    )
    db.add(pay)
    db.flush()

    first_month_row: Optional[PaymentMonth] = None
    for line in schedule:
        ym = (line.month or "").strip()
        if len(ym) != 7 or ym[4] != "-":
            raise HTTPException(status_code=400, detail=f"Неверный месяц в графике: {ym}")
        line_amt = Decimal(str(line.amount)).quantize(Decimal("0.01"))
        if line_amt <= 0:
            raise HTTPException(status_code=400, detail="Сумма в графике должна быть больше 0")
        due = resolve_payment_month_due_date(ym, line.due_date, pay)
        pm = PaymentMonth(
            payment_id=pay.id,
            month=ym,
            due_date=due,
            amount=line_amt,
            description=(line.description or "").strip() or None,
            status="pending",
        )
        db.add(pm)
        db.flush()
        if first_month_row is None:
            first_month_row = pm

    recv_amt: Optional[Decimal] = None
    recv_on: Optional[date] = None
    if first_payment_received and first_month_row is not None:
        recv_amt = Decimal(str(received_amount if received_amount is not None else first_month_row.amount)).quantize(
            Decimal("0.01")
        )
        recv_on = received_amount_on or date.today()
        first_month_row.status = "paid"
        first_month_row.paid_at = datetime.now(timezone.utc)
        first_month_row.confirmed_by = actor.id
        first_month_row.received_payment_method = received_payment_method or "transfer"
        pay.status = "paid"
        pay.paid_at = datetime.now(timezone.utc)
        pay.confirmed_by = actor.id
        pay.received_payment_method = received_payment_method or "transfer"

    comm_type = commission_type_for_category(pay.project_category, project_type)
    project_name = description.strip() or deal.title
    commission = Commission(
        company_slug=slug,
        project_name=project_name,
        project_type=comm_type,
        project_cost=contract_amt,
        production_cost=Decimal(str(production_cost or 0)).quantize(Decimal("0.01")),
        manager_percent=pct,
        actual_payment=recv_amt,
        received_amount_1=recv_amt,
        received_amount_1_on=recv_on,
        project_date=recv_on or date.today(),
        note=f"Из CRM-сделки #{deal.id}",
        manager_id=mop_id,
        payment_id=pay.id,
    )
    db.add(commission)
    db.flush()

    deal.payment_id = pay.id
    deal.commission_id = commission.id
    deal.stage_id = stage.id
    deal.closed_at = datetime.now(timezone.utc)

    db.add(
        SaleDealComment(
            company_slug=slug,
            deal_id=deal.id,
            body=f"Сделка закрыта: проект #{pay.id}, комиссия {pct}%",
            kind="system",
            meta_json=json.dumps({"payment_id": pay.id, "commission_id": commission.id}),
            created_by_user_id=actor.id,
        )
    )
    db.add(
        SaleDealComment(
            company_slug=slug,
            deal_id=deal.id,
            body=f"Этап: {stage.name}",
            kind="stage_change",
            meta_json=json.dumps({"to": stage.name}),
            created_by_user_id=actor.id,
        )
    )

    return pay, commission
