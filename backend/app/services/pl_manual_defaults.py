"""Стартовые ручные строки P&L по компаниям.

Нужны для дивидендов учредителей: строки создаются как ручные расходы
с привязкой к «Чистой прибыли», но только если их ещё нет.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.pl_manual_line import PlManualLine

DEFAULT_NET_PROFIT_LINES: dict[str, tuple[str, ...]] = {
    "kelyanmedia": ("Агаси Д",),
    "whiteway": ("Ани Д", "Агаси Д"),
    "enter_group_media": ("Жама Д", "Агаси Д"),
}


def ensure_pl_manual_defaults(db: Session, company_slug: str) -> None:
    labels = DEFAULT_NET_PROFIT_LINES.get(company_slug, ())
    if not labels:
        return

    existing_rows = {
        str(row.label).strip().lower(): row
        for row in db.query(PlManualLine)
        .filter(
            PlManualLine.company_slug == company_slug,
            PlManualLine.section == "expenses_fixed",
        )
        .all()
    }

    did = False
    base_sort = 900
    for idx, label in enumerate(labels):
        key = label.strip().lower()
        row = existing_rows.get(key)
        if row is None:
            db.add(
                PlManualLine(
                    company_slug=company_slug,
                    section="expenses_fixed",
                    label=label,
                    sort_order=base_sort + idx,
                    link_to_net_profit=True,
                )
            )
            did = True
            continue
        if not bool(getattr(row, "link_to_net_profit", False)):
            row.link_to_net_profit = True
            did = True

    if did:
        db.commit()
