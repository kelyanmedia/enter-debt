"""Расчёт Founder Income не должен выдавать дивиденды из отрицательной прибыли."""
from __future__ import annotations

import os
import sys
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.api.routes import finance_projects_cost as fpc


def test_founder_income_is_percent_of_positive_net_project_profit():
    assert fpc._founder_income_amount(Decimal("14025400"), Decimal("20")) == Decimal("2805080.00")


def test_founder_income_is_zero_for_loss_project():
    assert fpc._founder_income_amount(Decimal("-1000"), Decimal("25")) == Decimal("0.00")
