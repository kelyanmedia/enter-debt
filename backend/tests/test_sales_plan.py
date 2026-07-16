"""Smoke-тесты плана продаж: seed категорий и распределение."""
from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.api.routes import sales_plan as sp


def test_default_categories_cover_tz():
    names = [c["name"] for c in sp.DEFAULT_CATEGORIES]
    assert "Сайты" in names
    assert "SEO" in names
    assert "SMM" in names
    assert len(sp.DEFAULT_CATEGORIES) == 6


def test_cat_out_shape():
    row = MagicMock()
    row.id = 1
    row.name = "SEO"
    row.color = "#22c55e"
    row.avg_check = 5_000_000
    row.sort_order = 1
    row.is_archived = False
    out = sp._cat_out(row)
    assert out.id == 1
    assert out.name == "SEO"
    assert out.avg_check == 5_000_000


def test_resolve_manager_scope_regular_user_forced_to_self():
    user = MagicMock()
    user.id = 42
    user.role = "mop"
    user.is_sales_rop = False
    mid, read_only = sp._resolve_manager_scope(
        MagicMock(), "kelyanmedia", user, 99, for_write=True
    )
    assert mid == 42
    assert read_only is False


def test_resolve_manager_scope_admin_aggregate_is_readonly():
    user = MagicMock()
    user.id = 1
    user.role = "admin"
    user.is_sales_rop = False
    mid, read_only = sp._resolve_manager_scope(
        MagicMock(), "kelyanmedia", user, None, for_write=False
    )
    assert mid is None
    assert read_only is True
