"""Тесты себестоимости проектов в P&L."""
from __future__ import annotations

import os
import sys
from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.api.routes import finance_projects_cost as fpc


def test_task_cost_net_uzs_usd_with_rate():
    t = MagicMock()
    t.cost_category = "design"
    t.amount = Decimal("100")
    t.budget_amount = Decimal("0")
    t.currency = "USD"
    t.work_date = date(2026, 6, 15)
    rates = {"2026-06": Decimal("12000")}
    assert fpc._task_cost_net_uzs(t, rates) == Decimal("1200000.00")


def test_task_cost_net_uzs_uzs():
    t = MagicMock()
    t.cost_category = "dev"
    t.amount = Decimal("500000")
    t.budget_amount = Decimal("100000")
    t.currency = "UZS"
    t.work_date = date(2026, 3, 1)
    assert fpc._task_cost_net_uzs(t, {}) == Decimal("400000.00")


def test_task_cost_net_uzs_skips_without_category_bucket():
    t = MagicMock()
    t.cost_category = "invalid"
    t.amount = Decimal("100")
    t.budget_amount = Decimal("0")
    t.currency = "UZS"
    t.work_date = date(2026, 1, 1)
    assert fpc._task_cost_net_uzs(t, {}) == Decimal("0")


def test_distribute_manual_cost_proportional_to_paid_months():
    p = MagicMock()
    p.created_at = date(2026, 1, 1)
    pm1 = MagicMock(month="2026-06", status="paid", amount=Decimal("100"))
    pm2 = MagicMock(month="2026-07", status="paid", amount=Decimal("300"))
    p.months = [pm1, pm2]
    p.amount = Decimal("100")
    out = [Decimal("0") for _ in range(12)]
    fpc._distribute_manual_cost_to_year_months(p, Decimal("400"), 2026, out)
    assert out[5] == Decimal("100.00")
    assert out[6] == Decimal("300.00")


def test_distribute_manual_cost_fallback_to_project_start():
    p = MagicMock()
    p.created_at = date(2026, 4, 10)
    p.months = []
    out = [Decimal("0") for _ in range(12)]
    fpc._distribute_manual_cost_to_year_months(p, Decimal("75000"), 2026, out)
    assert out[3] == Decimal("75000")
    assert sum(out) == Decimal("75000")


def test_payment_manual_projects_cost_uzs_sums_columns():
    p = MagicMock()
    p.projects_cost_design_uzs = Decimal("10")
    p.projects_cost_dev_uzs = Decimal("20")
    p.projects_cost_other_uzs = Decimal("30")
    p.projects_cost_seo_uzs = Decimal("40")
    assert fpc._payment_manual_projects_cost_uzs(p) == Decimal("100.00")
