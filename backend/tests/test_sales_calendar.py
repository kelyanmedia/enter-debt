"""Smoke-тест привязки встреч к клиентской базе."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

# backend root on path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.api.routes import sales_calendar as cal


def test_resolve_company_with_id():
    db = MagicMock()
    co = MagicMock()
    co.company_name = "Acme Group"
    co.id = 42
    co.assigned_manager_id = 7
    db.query.return_value.filter.return_value.first.return_value = co

    user = MagicMock(role="admin", id=1)
    user.is_sales_rop = False
    name, cid = cal._resolve_company(db, "kelyanmedia", 42, "", user)
    assert name == "Acme Group"
    assert cid == 42


def test_resolve_company_mop_denied():
    db = MagicMock()
    co = MagicMock()
    co.company_name = "Acme Group"
    co.id = 42
    co.assigned_manager_id = 7
    db.query.return_value.filter.return_value.first.return_value = co

    user = MagicMock(role="mop", id=99)
    user.is_sales_rop = False
    import pytest
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        cal._resolve_company(db, "kelyanmedia", 42, "", user)
    assert exc.value.status_code == 403


def test_resolve_company_manual_name():
    db = MagicMock()
    user = MagicMock(role="admin")
    name, cid = cal._resolve_company(db, "kelyanmedia", None, "  Star Ins  ", user)
    assert name == "Star Ins"
    assert cid is None


def test_service_meta_unknown_falls_back():
    meta = cal._service_meta("unknown_key")
    assert meta["key"] == "discovery" or meta["label"] == "Discovery Call"


def test_serialize_shape():
    m = MagicMock()
    m.id = 1
    m.contact_name = "John"
    m.company_name = "Acme"
    m.sales_company_id = 5
    m.sale_deal_id = None
    m.service_type = "onboarding"
    m.starts_at = datetime(2026, 6, 29, 10, 0, tzinfo=timezone.utc)
    m.duration_minutes = 60
    m.notes = None
    m.created_by_user_id = 2
    m.created_by_user = MagicMock()
    m.created_by_user.name = "Anna"
    p = MagicMock()
    p.user_id = 3
    p.user = MagicMock()
    p.user.name = "Bob"
    m.participants = [p]

    out = cal._serialize(m)
    assert out["company_name"] == "Acme"
    assert out["service_label"] == "Onboarding"
    assert out["created_by_user_name"] == "Anna"
    assert out["participants"][0]["name"] == "Bob"


if __name__ == "__main__":
    test_resolve_company_with_id()
    test_resolve_company_mop_denied()
    test_resolve_company_manual_name()
    test_service_meta_unknown_falls_back()
    test_serialize_shape()
    print("sales_calendar linkage tests: OK")
