"""Тесты API имущества."""
from __future__ import annotations

import os
import sys
from datetime import date
from unittest.mock import MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.api.routes import company_assets as ca


def _set_optional_issue_and_icloud_fields(row):
    row.assigned_to_user_id = None
    row.assigned_to_user = None
    row.issued_on = None
    row.issued_items = None
    row.storage_location = None
    row.icloud_login = None
    row.icloud_password = None


def test_to_out_has_photo_flag():
    row = MagicMock()
    row.id = 1
    row.name = "Стол"
    row.purchased_on = date(2026, 3, 1)
    row.serial_number = None
    row.seller_contacts = None
    row.notes = None
    row.photo_path = "abc.jpg"
    row.created_at = None
    row.updated_at = None
    _set_optional_issue_and_icloud_fields(row)
    out = ca._to_out(row)
    assert out.name == "Стол"
    assert out.has_photo is True


def test_to_out_without_photo():
    row = MagicMock()
    row.id = 2
    row.name = "Пенал"
    row.purchased_on = None
    row.serial_number = None
    row.seller_contacts = None
    row.notes = None
    row.photo_path = None
    row.created_at = None
    row.updated_at = None
    _set_optional_issue_and_icloud_fields(row)
    out = ca._to_out(row)
    assert out.has_photo is False
