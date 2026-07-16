"""Проверка обязательных полей сделки."""
from types import SimpleNamespace

from app.services.deal_field_requirements import (
    missing_field_labels,
    missing_required_fields,
)


def _deal(**kw):
    defaults = dict(
        contact_name=None,
        phone=None,
        contact_position=None,
        company_name=None,
        source=None,
        client_geo="UZ",
        service_type="seo",
    )
    defaults.update(kw)
    return SimpleNamespace(**defaults)


def test_missing_when_automation_requires_name_and_phone():
    d = _deal(contact_name="", phone="+998", company_name="Acme")
    missing = missing_required_fields(d, ["contact_name", "phone", "company_name"])
    assert missing == ["contact_name", "phone"]
    assert "Имя" in missing_field_labels(missing)[0]


def test_phone_ok_with_full_uz_number():
    d = _deal(phone="+998 90 123 45 67", contact_name="Ali")
    assert missing_required_fields(d, ["contact_name", "phone"]) == []


def test_empty_requirements_never_block():
    d = _deal()
    assert missing_required_fields(d, []) == []
