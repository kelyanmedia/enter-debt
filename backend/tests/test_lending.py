"""Тесты кредитования: категории, расчёт процентов."""
from __future__ import annotations

import os
import sys
from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.api.routes import finance_lending as fl


def _lending_row(**kwargs):
    row = MagicMock()
    row.company_slug = kwargs.get("company_slug", "kelyanmedia")
    row.entity_name = kwargs.get("entity_name", "Test")
    row.lending_category = kwargs.get("lending_category", "external")
    row.record_type = kwargs.get("record_type", "interest_loan")
    row.issued_on = kwargs.get("issued_on", date(2026, 1, 1))
    row.principal_uzs = kwargs.get("principal_uzs", Decimal("1000000"))
    row.monthly_rate_percent = kwargs.get("monthly_rate_percent", Decimal("5"))
    row.deadline_date = kwargs.get("deadline_date", None)
    return row


def test_internal_lending_no_interest():
    row = _lending_row(
        lending_category="internal",
        record_type="interest_free",
        monthly_rate_percent=None,
    )
    total, months, _ = fl._calculated_total(row)
    assert total == Decimal("1000000.00")
    assert months >= 0


def test_external_lending_with_interest():
    row = _lending_row(
        lending_category="external",
        record_type="interest_loan",
        deadline_date=date(2026, 3, 1),
    )
    total, months, _ = fl._calculated_total(row)
    assert months >= 2
    assert total > Decimal("1000000")


def test_normalize_internal_forces_no_rate():
    row = _lending_row(
        lending_category="internal",
        record_type="interest_loan",
        principal_uzs=Decimal("100"),
        monthly_rate_percent=Decimal("5"),
    )
    fl._normalize_lending_row(row)
    assert row.record_type == "interest_free"
    assert row.monthly_rate_percent is None


def test_charged_months_day_rule():
    assert fl._charged_months(date(2026, 4, 25), date(2026, 5, 25)) == 1
    assert fl._charged_months(date(2026, 4, 25), date(2026, 5, 26)) == 2
