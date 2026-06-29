"""Статьи себестоимости Projects Cost (привязка расхода/задачи к проекту)."""
from __future__ import annotations

from typing import Optional, Tuple

PC_COST_CATEGORY_LABELS = {
    "design": "Дизайн",
    "dev": "Разработка",
    "other": "Прочее",
    "seo": "SEO",
    "contractor": "Подрядчик",
}

PC_COST_CATEGORY_SLUGS = frozenset(PC_COST_CATEGORY_LABELS.keys())

# Колонки в отчёте Projects Cost
_PC_COLUMN_CATS = frozenset({"design", "dev", "other", "seo"})


def pc_cost_categories_for_api():
    return [{"slug": k, "label": v} for k, v in PC_COST_CATEGORY_LABELS.items()]


def pc_cost_column_bucket(cat: Optional[str]) -> Optional[str]:
    """Статья → колонка себестоимости (contractor → other)."""
    c = (cat or "").strip().lower()
    if not c:
        return None
    if c == "contractor":
        return "other"
    if c in _PC_COLUMN_CATS:
        return c
    return None


def validate_pc_cost_allocation(
    payment_id: Optional[int],
    cost_category: Optional[str],
) -> Tuple[Optional[int], Optional[str]]:
    """Проект + статья: оба заданы или оба пусты."""
    pid = int(payment_id) if payment_id is not None else None
    cat_raw = (cost_category or "").strip().lower() if cost_category is not None else ""
    if cost_category is not None and not str(cost_category).strip():
        cat_raw = ""
    if pid is None and not cat_raw:
        return None, None
    if pid is None or not cat_raw:
        raise ValueError("Укажите проект и статью себестоимости Projects Cost, либо снимите оба поля.")
    if cat_raw not in PC_COST_CATEGORY_SLUGS:
        raise ValueError("Статья: design, dev, other, seo или contractor (подрядчик).")
    return pid, cat_raw
