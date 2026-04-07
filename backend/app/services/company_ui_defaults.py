"""Значения по умолчанию для подписей разделов и линий проектов (как в legacy UI)."""

from __future__ import annotations

from typing import Tuple

from sqlalchemy.orm import Session

from app.models.company_ui import CompanyPaymentsSegment, CompanyProjectLine, CompanyProjectsCostField

# Ключи сегментов фиксированы — меняются только подписи и видимость.
SEGMENT_KEYS: Tuple[str, ...] = ("all", "services", "hosting")

DEFAULT_SEGMENT_LABELS: dict[str, str] = {
    "all": "Все",
    "services": "Услуги",
    "hosting": "Домены/хостинг",
}

# Все допустимые project_category (как в frontend PAYMENTS_CATEGORY_QUERY_VALUES).
CANONICAL_CATEGORY_SLUGS: Tuple[str, ...] = (
    "smm",
    "target",
    "personal_brand",
    "content",
    "web",
    "seo",
    "ppc",
    "mobile_app",
    "tech_support",
    "events",
    "hosting_domain",
)

DEFAULT_LINE_LABELS: dict[str, str] = {
    "smm": "SMM",
    "target": "Таргет",
    "personal_brand": "Личный бренд",
    "content": "Контент",
    "web": "Web",
    "seo": "SEO",
    "ppc": "PPC",
    "mobile_app": "Моб. приложение",
    "tech_support": "Тех. сопр.",
    "events": "Ивенты",
    "hosting_domain": "Хостинг/домен",
}

PROJECTS_COST_FIELD_KEYS: Tuple[str, ...] = (
    "cost_design_uzs",
    "cost_dev_uzs",
    "cost_other_uzs",
    "cost_seo_uzs",
)

DEFAULT_PROJECTS_COST_FIELD_LABELS: dict[str, str] = {
    "cost_design_uzs": "Дизайн",
    "cost_dev_uzs": "Разраб.",
    "cost_other_uzs": "Прочее",
    "cost_seo_uzs": "SEO",
}


def ensure_company_ui_rows(db: Session, company_slug: str) -> None:
    """Создаёт строки по умолчанию и добавляет новые канонические линии (миграция вперёд)."""
    did = False
    has_seg = (
        db.query(CompanyPaymentsSegment.id)
        .filter(CompanyPaymentsSegment.company_slug == company_slug)
        .first()
    )
    if not has_seg:
        for i, key in enumerate(SEGMENT_KEYS):
            db.add(
                CompanyPaymentsSegment(
                    company_slug=company_slug,
                    segment_key=key,
                    label=DEFAULT_SEGMENT_LABELS[key],
                    sort_order=i,
                    is_visible=True,
                )
            )
        did = True

    has_line = (
        db.query(CompanyProjectLine.id).filter(CompanyProjectLine.company_slug == company_slug).first()
    )
    if not has_line:
        for i, slug in enumerate(CANONICAL_CATEGORY_SLUGS):
            db.add(
                CompanyProjectLine(
                    company_slug=company_slug,
                    category_slug=slug,
                    label=DEFAULT_LINE_LABELS.get(slug, slug),
                    sort_order=i,
                    is_visible=True,
                )
            )
        did = True
        existing_slugs = set(CANONICAL_CATEGORY_SLUGS)
    else:
        existing_slugs = {
            row[0]
            for row in db.query(CompanyProjectLine.category_slug)
            .filter(CompanyProjectLine.company_slug == company_slug)
            .all()
        }
    for i, slug in enumerate(CANONICAL_CATEGORY_SLUGS):
        if slug not in existing_slugs:
            db.add(
                CompanyProjectLine(
                    company_slug=company_slug,
                    category_slug=slug,
                    label=DEFAULT_LINE_LABELS.get(slug, slug),
                    sort_order=i,
                    is_visible=True,
                )
            )
            did = True

    if did:
        db.commit()


def ensure_projects_cost_field_rows(db: Session, company_slug: str) -> None:
    did = False
    existing = {
        row[0]
        for row in db.query(CompanyProjectsCostField.field_key)
        .filter(CompanyProjectsCostField.company_slug == company_slug)
        .all()
    }
    for key in PROJECTS_COST_FIELD_KEYS:
        if key in existing:
            continue
        db.add(
            CompanyProjectsCostField(
                company_slug=company_slug,
                field_key=key,
                label=DEFAULT_PROJECTS_COST_FIELD_LABELS[key],
            )
        )
        did = True
    if did:
        db.commit()
