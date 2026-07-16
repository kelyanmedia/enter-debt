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


def test_funnel_only_stages_with_deals_ordered():
    def stage(name, sort, won=False, lost=False):
        s = MagicMock()
        s.name = name
        s.sort_order = sort
        s.is_closed_won = won
        s.is_closed_lost = lost
        s.color = None
        return s

    deals = []
    for name, sort, n in [
        ("ПЕРВИЧНЫЙ КОНТАКТ", 0, 5),
        ("В РАБОТЕ", 1, 2),
        ("СДЕЛКА ВЫИГРАНА", 11, 1),
    ]:
        for _ in range(n):
            d = MagicMock()
            d.stage = stage(name, sort, won=(name == "СДЕЛКА ВЫИГРАНА"))
            d.budget = 0
            deals.append(d)

    # empty closed-lost stage must NOT appear
    empty_lost = MagicMock()
    empty_lost.stage = stage("НЕДОСТУПЕН", 4, lost=True)
    # not in deals

    funnel = sa._build_funnel_from_deals(deals, lambda d: 0)
    names = [r["name"] for r in funnel]
    assert names[0] == "ПЕРВИЧНЫЙ КОНТАКТ"
    assert names[1] == "В РАБОТЕ"
    assert "НЕДОСТУПЕН" not in names
    assert names[-1] == "СДЕЛКА ВЫИГРАНА"
    assert funnel[0]["count"] == 5


def test_lead_sources_from_deal_source_field():
    def deal(src):
        d = MagicMock()
        d.source = src
        return d

    deals = [
        deal("Веб-сайт"),
        deal("Веб-сайт"),
        deal(None),
        deal("  "),
        deal("Соцсети"),
    ]
    sources = sa._build_lead_sources_from_deals(deals)
    by_name = {s["name"]: s["count"] for s in sources}
    assert by_name["Веб-сайт"] == 2
    assert by_name["Не указан"] == 2
    assert by_name["Соцсети"] == 1
    assert sum(s["count"] for s in sources) == 5
