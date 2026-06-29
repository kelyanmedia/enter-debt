"""Справочник услуг и тегов для CRM-сделок."""
from __future__ import annotations

from typing import Any, Dict, List

DEAL_SERVICES: List[Dict[str, Any]] = [
    {"key": "seo", "label": "SEO", "color": "#059669"},
    {"key": "smm", "label": "SMM", "color": "#7c3aed"},
    {"key": "web", "label": "Сайт / веб", "color": "#2563eb"},
    {"key": "ppc", "label": "PPC / таргет", "color": "#ea580c"},
    {"key": "branding", "label": "Брендинг", "color": "#db2777"},
    {"key": "video", "label": "Видео / продакшн", "color": "#0891b2"},
    {"key": "mobile", "label": "Мобильное приложение", "color": "#4f46e5"},
    {"key": "support", "label": "Техподдержка", "color": "#64748b"},
]

DEAL_TAG_PRESETS: List[str] = [
    "SEO",
    "SMM",
    "Лендинг",
    "Контекст",
    "Таргет",
    "Брендинг",
    "Дизайн",
    "Разработка",
    "Контент",
    "CRM",
    "Аналитика",
    "Retainer",
    "Абонент",
    "Разовый проект",
]

_SERVICE_BY_KEY = {s["key"]: s for s in DEAL_SERVICES}
_DEFAULT_SERVICE = "seo"


def normalize_service_type(value: str | None) -> str:
    key = (value or "").strip().lower()
    if key in _SERVICE_BY_KEY:
        return key
    return _DEFAULT_SERVICE


def service_label(key: str | None) -> str:
    return _SERVICE_BY_KEY.get(normalize_service_type(key), _SERVICE_BY_KEY[_DEFAULT_SERVICE])["label"]


def normalize_deal_tags(tags: List[str] | None) -> List[str]:
    allowed = set(DEAL_TAG_PRESETS)
    out: List[str] = []
    for raw in tags or []:
        t = (raw or "").strip()
        if t in allowed and t not in out:
            out.append(t)
    return out[:12]
