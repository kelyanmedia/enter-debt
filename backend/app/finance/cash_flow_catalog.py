"""Справочники категорий ДДС / P&L (расходы) и нормализация для агрегатов."""
from __future__ import annotations

from typing import Dict, List, Tuple

# slug → подпись (как в вашей таблице)
EXPENSE_CATEGORY_LABELS: Dict[str, str] = {
    "salary": "Зарплата",
    "debt_repayment": "Возврат долга",
    "investment_return": "Возврат инвестиций",
    "taxes": "Налоги",
    "travel": "Дорога",
    "marketing": "Маркетинг",
    "other": "Прочее",
    "recruiting": "Рекрутинг",
    "office": "Офис",
    "fund_development": "Ф: развития, кризиса, прочность, обучение",
    "it_infra": "IT инфраструктура",
    "dividends": "Дивиденды",
    "refund": "Возврат",
    "loss": "Утеря",
    "printing": "Распечатки и канцелярия",
    "lunch": "Обед",
    "debt": "Долг",
    "accounting": "Бухгалтерия",
    "personal_brand": "Личный бренд",
    "publics": "Паблики",
    "it_project": "IT проект",
    "services": "Оказание услуг",
}


def expense_categories_for_api() -> List[Dict[str, str]]:
    return [{"slug": k, "label": v} for k, v in sorted(EXPENSE_CATEGORY_LABELS.items(), key=lambda x: x[1])]


def normalize_flow_category(slug: str | None) -> str:
    return (slug or "").strip().lower()


def expense_pl_bucket(slug: str | None) -> str:
    """
    Группа для строк P&L (ДДС расходы).
    salary | office | accounting | marketing | taxes | personal_brand | publics | other
    """
    c = normalize_flow_category(slug)
    if c in ("salary", "зарплата"):
        return "salary"
    if c in ("office", "офис"):
        return "office"
    if c in ("accounting", "бухгалтерия", "accounting_fees"):
        return "accounting"
    if c in ("marketing", "маркетинг"):
        return "marketing"
    if c in ("taxes", "налоги", "tax"):
        return "taxes"
    if c in ("personal_brand", "personalbrand", "личный бренд"):
        return "personal_brand"
    if c in ("publics", "паблики", "public"):
        return "publics"
    return "other"


# Для приходов в ДДС (при необходимости расширить)
INCOME_CATEGORY_LABELS: Dict[str, str] = {
    "services": "Оказание услуг",
    "other_income": "Прочий доход",
}


def income_categories_for_api() -> List[Dict[str, str]]:
    return [{"slug": k, "label": v} for k, v in sorted(INCOME_CATEGORY_LABELS.items(), key=lambda x: x[1])]


PAYMENT_METHODS: List[Tuple[str, str]] = [
    ("cash", "Наличка"),
    ("card", "Карта"),
    ("transfer", "Перечисление"),
]
