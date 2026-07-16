"""Обязательные поля сделки (автоматизации CRM) — проверка заполненности."""
from __future__ import annotations

import json
from typing import List, Optional, Sequence

from sqlalchemy.orm import Session

from app.models.sale_deal_field_requirement import SaleDealFieldRequirement
from app.models.sale_pipeline import SaleDeal

ALLOWED_FIELDS = (
    "contact_name",
    "phone",
    "contact_position",
    "company_name",
    "source",
    "client_geo",
    "service_type",
)

FIELD_LABELS = {
    "contact_name": "Имя (ФИО)",
    "phone": "Телефон",
    "contact_position": "Должность",
    "company_name": "Компания",
    "source": "Источник лида",
    "client_geo": "GEO клиента",
    "service_type": "Услуга",
}


def parse_required_fields(raw: Optional[str]) -> List[str]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except Exception:
        return []
    if not isinstance(data, list):
        return []
    return [str(x) for x in data if str(x) in ALLOWED_FIELDS]


def get_required_fields_for_manager(
    db: Session,
    company_slug: str,
    manager_user_id: Optional[int],
) -> List[str]:
    if not manager_user_id:
        return []
    row = (
        db.query(SaleDealFieldRequirement)
        .filter(
            SaleDealFieldRequirement.company_slug == company_slug,
            SaleDealFieldRequirement.manager_user_id == int(manager_user_id),
        )
        .first()
    )
    return parse_required_fields(row.required_fields if row else None)


def _field_filled(deal: SaleDeal, key: str) -> bool:
    if key == "contact_name":
        return bool((deal.contact_name or "").strip())
    if key == "phone":
        digits = "".join(ch for ch in (deal.phone or "") if ch.isdigit())
        return len(digits) >= 12
    if key == "contact_position":
        return bool((deal.contact_position or "").strip())
    if key == "company_name":
        return bool((deal.company_name or "").strip())
    if key == "source":
        return bool((deal.source or "").strip())
    if key == "client_geo":
        return bool((deal.client_geo or "").strip())
    if key == "service_type":
        return bool((deal.service_type or "").strip())
    return True


def missing_required_fields(deal: SaleDeal, required: Sequence[str]) -> List[str]:
    return [k for k in required if k in ALLOWED_FIELDS and not _field_filled(deal, k)]


def missing_field_labels(missing: Sequence[str]) -> List[str]:
    return [FIELD_LABELS.get(k, k) for k in missing]
