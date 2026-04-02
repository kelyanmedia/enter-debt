"""Первичное заполнение шаблонов ДДС (по одной на компанию / БД)."""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.cash_flow import CashFlowTemplateLine


def seed_cash_flow_templates(db: Session) -> None:
    if db.query(CashFlowTemplateLine).first() is not None:
        return
    rows = [
        CashFlowTemplateLine(
            template_group="monthly_salary",
            sort_order=1,
            label="Влад",
            default_amount_uzs=Decimal("5000000"),
            default_amount_usd=Decimal("0"),
            flow_category="salary",
            payment_method="transfer",
            direction="expense",
        ),
        CashFlowTemplateLine(
            template_group="monthly_salary",
            sort_order=2,
            label="Обиджон",
            default_amount_uzs=Decimal("5000000"),
            default_amount_usd=Decimal("0"),
            flow_category="salary",
            payment_method="transfer",
            direction="expense",
        ),
        CashFlowTemplateLine(
            template_group="monthly_salary",
            sort_order=3,
            label="Суннат",
            default_amount_uzs=Decimal("5000000"),
            default_amount_usd=Decimal("0"),
            flow_category="salary",
            payment_method="transfer",
            direction="expense",
        ),
        CashFlowTemplateLine(
            template_group="monthly_salary",
            sort_order=4,
            label="Рустам",
            default_amount_uzs=Decimal("5000000"),
            default_amount_usd=Decimal("0"),
            flow_category="salary",
            payment_method="transfer",
            direction="expense",
        ),
        CashFlowTemplateLine(
            template_group="monthly_admin",
            sort_order=1,
            label="Офис",
            default_amount_uzs=Decimal("17500000"),
            default_amount_usd=Decimal("0"),
            flow_category="office",
            payment_method="transfer",
            direction="expense",
        ),
        CashFlowTemplateLine(
            template_group="monthly_admin",
            sort_order=2,
            label="Расходы бухгалтерии",
            default_amount_uzs=Decimal("5500000"),
            default_amount_usd=Decimal("0"),
            flow_category="accounting",
            payment_method="transfer",
            direction="expense",
        ),
    ]
    for r in rows:
        db.add(r)
    db.commit()
