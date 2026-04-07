"""Первичное заполнение шаблонов ДДС (по одной на компанию / БД)."""
from __future__ import annotations

import logging
from decimal import Decimal

from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.orm import Session

from app.db.database import get_request_company
from app.models.cash_flow import CashFlowTemplateLine

log = logging.getLogger(__name__)


def seed_cash_flow_templates(db: Session) -> None:
    slug = get_request_company()
    try:
        if (
            db.query(CashFlowTemplateLine)
            .filter(CashFlowTemplateLine.company_slug == slug)
            .first()
            is not None
        ):
            return
    except (OperationalError, ProgrammingError) as e:
        db.rollback()
        log.warning(
            "ДДС шаблоны: пропуск сидинга (схема БД не совпадает с моделью, нужна миграция/новая БД): %s",
            e,
        )
        return
    rows = [
        CashFlowTemplateLine(
            company_slug=slug,
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
            company_slug=slug,
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
            company_slug=slug,
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
            company_slug=slug,
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
            company_slug=slug,
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
            company_slug=slug,
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
    try:
        for r in rows:
            db.add(r)
        db.commit()
    except (OperationalError, ProgrammingError) as e:
        db.rollback()
        log.warning("ДДС шаблоны: не удалось записать начальные строки: %s", e)
