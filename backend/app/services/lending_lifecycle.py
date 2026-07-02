"""Жизненный цикл кредитования: закрытие при оплате клиента, сводка по проектам."""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Dict, List, Tuple

from sqlalchemy.orm import Session

from app.db.database import get_request_company
from app.models.lending_record import LendingRecord


def close_active_lending_for_payment(
    db: Session,
    payment_id: int,
    company_slug: str | None = None,
) -> int:
    """Закрыть активные записи кредитования по проекту (клиент оплатил — кредит снят)."""
    slug = company_slug or get_request_company()
    now = datetime.now(timezone.utc)
    rows = (
        db.query(LendingRecord)
        .filter(
            LendingRecord.payment_id == payment_id,
            LendingRecord.company_slug == slug,
            LendingRecord.closed_at.is_(None),
        )
        .all()
    )
    for r in rows:
        r.closed_at = now
    return len(rows)


def active_lending_by_payment_id(
    db: Session,
    company_slug: str | None = None,
) -> Dict[int, Tuple[Decimal, List[LendingRecord]]]:
    """Сумма и список активных кредитов по payment_id (только открытые)."""
    slug = company_slug or get_request_company()
    out: Dict[int, Tuple[Decimal, List[LendingRecord]]] = {}
    rows = (
        db.query(LendingRecord)
        .filter(
            LendingRecord.company_slug == slug,
            LendingRecord.closed_at.is_(None),
            LendingRecord.payment_id.isnot(None),
        )
        .order_by(LendingRecord.id.asc())
        .all()
    )
    for r in rows:
        pid = int(r.payment_id)  # type: ignore[arg-type]
        principal = Decimal(str(r.principal_uzs or 0))
        total, items = out.get(pid, (Decimal("0"), []))
        items.append(r)
        out[pid] = (total + principal, items)
    return out
