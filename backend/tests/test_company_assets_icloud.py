"""Пароль Apple ID в реестре имущества не хранится открытым в БД."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.api.routes.company_assets import _decrypt_icloud_password, _encrypt_icloud_password


def test_icloud_password_is_encrypted_and_can_be_decrypted():
    password = "test-apple-password"
    stored = _encrypt_icloud_password(password)

    assert stored is not None
    assert stored.startswith("v1:")
    assert password not in stored
    assert _decrypt_icloud_password(stored) == password


def test_blank_icloud_password_is_not_stored():
    assert _encrypt_icloud_password("   ") is None
