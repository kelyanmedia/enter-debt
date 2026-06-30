"""Тесты аналитики продаж."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.api.routes import sales_analytics as sa


def test_build_revenue_performance_timezone_aware_deals():
    deal = MagicMock()
    deal.created_at = datetime(2026, 5, 28, 12, 0, tzinfo=timezone.utc)
    deal.budget = Decimal("1000")
    deal.currency = "USD"

    anchor = datetime(2026, 5, 31)
    out = sa._build_revenue_performance(
        [deal],
        anchor,
        "7d",
        lambda d: float(d.budget or 0),
    )
    assert out["labels"]
    assert len(out["revenue"]) == len(out["labels"])
    assert sum(out["revenue"]) >= 1000


def test_naive_dt_strips_timezone():
    aware = datetime(2026, 5, 1, 10, 0, tzinfo=timezone.utc)
    naive = sa._naive_dt(aware)
    assert naive is not None
    assert naive.tzinfo is None
    assert naive.hour == 10
