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
    "fund_development": "Бюджет на развитие",
    "it_infra": "IT инфраструктура",
    "subscriptions": "Подписки",
    "dividends": "Дивиденды",
    "agasi_d": "Дивиденды учредителей",
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
    # legacy slug agasi_d нужен для старых записей, но в UI показываем только общий dividends
    visible = {k: v for k, v in EXPENSE_CATEGORY_LABELS.items() if k != "agasi_d"}
    return [{"slug": k, "label": v} for k, v in sorted(visible.items(), key=lambda x: x[1])]


def normalize_flow_category(slug: str | None) -> str:
    return (slug or "").strip().lower()


def expense_pl_bucket(slug: str | None) -> str:
    """
    Группа для строк P&L (ДДС расходы).
    salary | office | accounting | marketing | taxes | personal_brand | publics | subscriptions | fund_development | agasi_d | other
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
    if c in ("subscriptions", "subscription", "подписки", "подписка"):
        return "subscriptions"
    if c in ("fund_development", "development_budget", "budget_development", "бюджет на развитие"):
        return "fund_development"
    if c in ("agasi_d", "agasi-d", "dividends", "dividend"):
        return "agasi_d"
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
