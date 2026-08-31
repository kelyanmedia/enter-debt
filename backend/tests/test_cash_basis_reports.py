"""Регрессии для финансовой истории фактических поступлений."""
from __future__ import annotations

import os
import sys
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Импорт приложения регистрирует все ORM-модели в общей metadata перед create_all.
import app.main  # noqa: F401
from app.api.routes import dashboard, finance_projects_cost
from app.db.database import Base, reset_company_context, set_company_context
from app.models.partner import Partner
from app.models.payment import Payment, PaymentMonth
from app.models.user import User
from app.services.available_funds import available_funds_for_period


def _make_db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)(), engine


def _seed_actual_august_receipts(db):
    admin = User(
        company_slug="kelyanmedia",
        name="Админ",
        email="admin@example.test",
        hashed_password="test",
        role="admin",
        is_active=True,
    )
    partner = Partner(company_slug="kelyanmedia", name="Клиент", status="active")
    archived_schedule = Payment(
        company_slug="kelyanmedia",
        partner=partner,
        payment_type="one_time",
        description="Web-проект с актом",
        amount=Decimal("24000000"),
        project_category="web",
        status="paid",
        paid_at=datetime(2026, 8, 26, 7, 0, tzinfo=timezone.utc),
        # Имитируем автоархив после оплаты без отмеченного акта.
        is_archived=True,
        received_payment_method="transfer",
    )
    PaymentMonth(
        payment=archived_schedule,
        month="2026-04",  # период услуги/акта, не месяц фактических денег
        due_date=date(2026, 4, 15),
        amount=Decimal("24000000"),
        status="paid",
        paid_at=datetime(2026, 8, 26, 7, 0, tzinfo=timezone.utc),
        received_payment_method="transfer",
        description="Web Апрель 2026 Акт/СФ",
    )
    direct_payment = Payment(
        company_slug="kelyanmedia",
        partner=partner,
        payment_type="one_time",
        description="Web-проект без графика",
        amount=Decimal("9000000"),
        project_category="web",
        status="paid",
        paid_at=datetime(2026, 8, 27, 9, 0, tzinfo=timezone.utc),
        received_payment_method="transfer",
    )
    db.add_all((admin, partner, archived_schedule, direct_payment))
    db.commit()
    return admin


def _row(report, row_id: str):
    return next(row for row in report.rows if row.row_id == row_id)


def test_actual_receipts_stay_in_financial_reports_after_auto_archive():
    token = set_company_context("kelyanmedia")
    db, engine = _make_db()
    try:
        admin = _seed_actual_august_receipts(db)

        report = finance_projects_cost.pl_report(year=2026, db=db, current_user=admin)
        web = _row(report, "rev_web")
        # Апрель — период акта, но фактических поступлений тогда не было.
        assert web.cells[3].uzs == Decimal("0.00")
        # 24 млн из архивного графика + 9 млн от оплаченного напрямую проекта.
        assert web.cells[7].uzs == Decimal("33000000.00")

        funds = available_funds_for_period(db, "2026-08")
        assert funds.from_payments_account_uzs == Decimal("33000000.00")
        assert available_funds_for_period(db, "2026-04").from_payments_account_uzs == Decimal("0.00")

        turnover = dashboard._build_paid_agg(db, admin, date(2026, 8, 1), date(2026, 8, 31))
        assert turnover == {(2026, 8): Decimal("33000000.00")}

        received = dashboard.received_payments_cashflow(year=2026, month=8, db=db, _=None)
        assert {row.amount for row in received} == {Decimal("24000000"), Decimal("9000000")}

        stats = dashboard.get_dashboard(
            date_from=date(2026, 8, 1),
            date_to=date(2026, 8, 31),
            manager_id=None,
            db=db,
            current_user=admin,
        )
        assert stats.paid_this_month == 2
        assert stats.paid_amount_this_month == Decimal("33000000.00")
    finally:
        db.close()
        Base.metadata.drop_all(engine)
        reset_company_context(token)
