"""Дефолтный порядок блоков CEO (как на странице до настройки).

При старте приложения для каждой компании из COMPANY_SLUG_ORDER вызывается
ensure_ceo_layout_defaults: если в БД ещё нет блоков — создаются четыре стандартных графика.
Уже сохранённая пользователем раскладка не трогается.
"""

from __future__ import annotations

import re
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models.ceo_dashboard_block import CeoDashboardBlock

# kind: client_history | turnover | pl_row | ltv
DEFAULT_CEO_BLOCKS: Tuple[Tuple[str, Optional[str]], ...] = (
    ("client_history", None),
    ("turnover", None),
    ("pl_row", "operating_profit"),
    ("ltv", None),
)


def ensure_ceo_layout_defaults(db: Session, company_slug: str) -> None:
    has = (
        db.query(CeoDashboardBlock.id)
        .filter(CeoDashboardBlock.company_slug == company_slug)
        .first()
    )
    if has:
        return
    for i, (kind, pl_row) in enumerate(DEFAULT_CEO_BLOCKS):
        db.add(
            CeoDashboardBlock(
                company_slug=company_slug,
                kind=kind,
                pl_row_id=pl_row,
                title=None,
                sort_order=i,
            )
        )
    db.commit()


def is_valid_pl_row_id(pl_row_id: str) -> bool:
    """Допустимые row_id из P&L: известные строки + rev_<категория>."""
    if not pl_row_id or len(pl_row_id) > 80:
        return False
    known = {
        "operating_profit",
        "net_profit",
        "rev_grand_total",
        "rev_cf_income",
        "exp_total",
        "exp_payroll_total",
        "exp_manager_commission",
        "exp_cf_office",
        "exp_cf_accounting",
        "exp_cf_publics",
        "exp_cf_taxes",
        "exp_cf_personal_brand",
        "exp_cf_marketing",
        "exp_cf_agasi_d",
        "exp_cf_other",
    }
    if pl_row_id in known:
        return True
    if pl_row_id.startswith("rev_") and len(pl_row_id) > 4:
        rest = pl_row_id[4:]
        return bool(rest.replace("_", "").isalnum() or "_" in rest)
    if re.match(r"^manual_\d+$", pl_row_id):
        return True
    return False


def validate_layout_blocks(blocks: List[dict]) -> Optional[str]:
    kinds = {"client_history", "turnover", "pl_row", "ltv"}
    for b in blocks:
        k = b.get("kind")
        if k not in kinds:
            return f"Неизвестный kind: {k}"
        if k == "pl_row":
            pid = (b.get("pl_row_id") or "").strip()
            if not pid:
                return "Для блока pl_row нужен pl_row_id"
            if not is_valid_pl_row_id(pid):
                return f"Недопустимый pl_row_id: {pid}"
        else:
            if b.get("pl_row_id"):
                return f"Для kind={k} pl_row_id не задаётся"
    return None
