"""НДС проекта: налог сверху в договоре, чистая сумма в финансовых отчётах."""
from __future__ import annotations

import os
import sys
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app.main  # noqa: F401 — регистрирует все ORM-модели
from app.api.routes import dashboard, finance_projects_cost, payments
from app.db.database import Base, reset_company_context, set_company_context
from app.models.partner import Partner
from app.models.payment import Payment, PaymentMonth
from app.models.user import User
from app.schemas.schemas import PaymentCreate, PaymentUpdate
from app.services import feed_events
from app.services.available_funds import available_funds_for_period
from app.services.vat import gross_amount_from_net, net_amount_from_gross


def _db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)(), engine


def _row(report, row_id: str):
    return next(row for row in report.rows if row.row_id == row_id)


def test_vat_is_added_on_top_and_financial_reports_use_net_amount(monkeypatch):
    assert gross_amount_from_net(Decimal("80000000"), Decimal("6")) == Decimal("84800000.00")
    assert gross_amount_from_net(Decimal("80000000"), Decimal("12")) == Decimal("89600000.00")
    assert net_amount_from_gross(Decimal("84800000"), Decimal("6")) == Decimal("80000000.00")
    assert net_amount_from_gross(Decimal("89600000"), Decimal("12")) == Decimal("80000000.00")

    token = set_company_context("kelyanmedia")
    db, engine = _db()
    try:
        admin = User(
            company_slug="kelyanmedia",
            name="Админ",
            email="vat-admin@example.test",
            hashed_password="test",
            role="admin",
            is_active=True,
        )
        partner = Partner(company_slug="kelyanmedia", name="Клиент с НДС", status="active")
        db.add_all((admin, partner))
        db.commit()

        monkeypatch.setattr(feed_events, "emit_payment_created", lambda *_args, **_kwargs: None)
        created = payments.create_payment(
            PaymentCreate(
                partner_id=partner.id,
                payment_type="one_time",
                description="WEB с НДС",
                amount=Decimal("80000000"),
                amount_without_vat=Decimal("80000000"),
                vat_rate=Decimal("6"),
            ),
            db=db,
            current_user=admin,
        )
        assert created.amount == Decimal("84800000.00")  # сумма договора / счёта
        assert created.amount_without_vat == Decimal("80000000.00")
        assert created.vat_amount == Decimal("4800000.00")

        # При редактировании ставка меняется, чистая цена остаётся той же.
        updated = payments.update_payment(
            created.id,
            PaymentUpdate(vat_rate=Decimal("12"), amount_without_vat=Decimal("80000000")),
            db=db,
            current_user=admin,
        )
        assert updated.amount == Decimal("89600000.00")
        assert updated.amount_without_vat == Decimal("80000000.00")
        assert updated.vat_amount == Decimal("9600000.00")

        payment = db.query(Payment).filter(Payment.id == created.id).one()
        db.add(
            PaymentMonth(
                payment_id=payment.id,
                month="2026-04",
                due_date=date(2026, 4, 15),
                amount=payment.amount,
                status="paid",
                paid_at=datetime(2026, 8, 26, 7, 0, tzinfo=timezone.utc),
                received_payment_method="transfer",
            )
        )
        db.commit()

        report = finance_projects_cost.pl_report(year=2026, db=db, current_user=admin)
        assert _row(report, "rev_uncategorized").cells[7].uzs == Decimal("80000000.00")

        funds = available_funds_for_period(db, "2026-08")
        assert funds.from_payments_account_uzs == Decimal("80000000.00")

        turnover = dashboard._build_paid_agg(db, admin, date(2026, 8, 1), date(2026, 8, 31))
        assert turnover == {(2026, 8): Decimal("80000000.00")}

        received = dashboard.received_payments_cashflow(year=2026, month=8, db=db, _=None)
        assert [row.amount for row in received] == [Decimal("80000000.00")]

        project_cost = finance_projects_cost.projects_cost_report(
            month_from=None,
            month_to=None,
            db=db,
            current_user=admin,
        )
        assert project_cost[0].billing_unit_amount == Decimal("80000000.00")
        assert project_cost[0].schedule_months[0].amount == Decimal("80000000.00")
    finally:
        db.close()
        Base.metadata.drop_all(engine)
        reset_company_context(token)


def test_only_supported_vat_rates_are_accepted():
    with pytest.raises(ValidationError, match="НДС"):
        PaymentCreate(
            partner_id=1,
            payment_type="one_time",
            description="Некорректный НДС",
            amount=Decimal("1"),
            vat_rate=Decimal("7"),
        )


def test_vat_inclusive_amount_is_split_without_manual_calculation(monkeypatch):
    token = set_company_context("kelyanmedia")
    db, engine = _db()
    try:
        admin = User(company_slug="kelyanmedia", name="Админ", email="vat-inclusive@example.test", hashed_password="test", role="admin", is_active=True)
        partner = Partner(company_slug="kelyanmedia", name="Клиент", status="active")
        db.add_all((admin, partner))
        db.commit()
        monkeypatch.setattr(feed_events, "emit_payment_created", lambda *_args, **_kwargs: None)

        created = payments.create_payment(
            PaymentCreate(
                partner_id=partner.id,
                payment_type="one_time",
                description="Сумма уже с НДС",
                amount=Decimal("11200000"),
                vat_rate=Decimal("12"),
                vat_included_in_amount=True,
            ),
            db=db,
            current_user=admin,
        )

        assert created.amount == Decimal("11200000")
        assert created.amount_without_vat == Decimal("10000000.00")
        assert created.vat_amount == Decimal("1200000.00")
        assert created.vat_included_in_amount is True
    finally:
        db.close()
        Base.metadata.drop_all(engine)
        reset_company_context(token)
