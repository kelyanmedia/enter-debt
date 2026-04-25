"""Учёт кредитования: выдача под % в месяц или безвозмездно на период."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.core.security import require_admin_or_financier
from app.db.database import get_db, get_request_company
from app.models.lending_record import LendingRecord
from app.models.payment import Payment
from app.models.user import User
from app.schemas.schemas import LendingRecordCreate, LendingRecordOut, LendingRecordUpdate

router = APIRouter(prefix="/api/finance", tags=["finance"])

_VALID_TYPES = frozenset({"interest_loan", "interest_free"})


def _charged_months(issued_on: date, calculation_date: date) -> int:
    """Процентный месяц считается по дате выдачи: 25.04→25.05 = 1, 26.05 = уже 2."""
    if calculation_date <= issued_on:
        return 0
    months = (calculation_date.year - issued_on.year) * 12 + (calculation_date.month - issued_on.month)
    if calculation_date.day > issued_on.day:
        months += 1
    return max(0, months)


def _calculation_date(row: LendingRecord) -> date:
    return row.deadline_date or date.today()


def _calculated_total(row: LendingRecord) -> tuple[Decimal, int, date]:
    principal = Decimal(str(row.principal_uzs or 0))
    calc_date = _calculation_date(row)
    months = _charged_months(row.issued_on, calc_date)
    if row.record_type == "interest_free":
        return principal.quantize(Decimal("0.01")), months, calc_date
    rate = Decimal(str(row.monthly_rate_percent or 0))
    total = principal + (principal * rate / Decimal("100") * Decimal(months))
    return total.quantize(Decimal("0.01")), months, calc_date


def _payment_label(row: LendingRecord) -> str | None:
    p = getattr(row, "payment", None)
    if p is None:
        return None
    desc = (p.description or "").strip() or f"#{p.id}"
    partner = getattr(p, "partner", None)
    partner_name = (getattr(partner, "name", None) or "").strip()
    return f"{desc} · {partner_name}" if partner_name else desc


def _validate_payment_id(db: Session, payment_id: int | None) -> int | None:
    if payment_id is None:
        return None
    p = (
        db.query(Payment)
        .filter(
            Payment.id == payment_id,
            Payment.company_slug == get_request_company(),
            Payment.is_archived == False,
            Payment.trashed_at.is_(None),
        )
        .first()
    )
    if not p:
        raise HTTPException(status_code=400, detail="Проект для привязки не найден")
    return int(payment_id)


def _to_out(row: LendingRecord) -> LendingRecordOut:
    total, months, calc_date = _calculated_total(row)
    return LendingRecordOut(
        id=int(row.id),
        entity_name=row.entity_name,
        record_type=row.record_type,  # type: ignore[arg-type]
        payment_id=row.payment_id,
        payment_label=_payment_label(row),
        issued_on=row.issued_on,
        principal_uzs=row.principal_uzs,
        monthly_rate_percent=row.monthly_rate_percent,
        total_repayment_uzs=total,
        deadline_date=row.deadline_date,
        charged_months=months,
        calculation_date=calc_date,
        period_note=row.period_note,
        note=row.note,
        created_at=row.created_at,
    )


def _validate_row_rules(row: LendingRecord) -> None:
    if row.record_type not in _VALID_TYPES:
        raise HTTPException(status_code=400, detail="Некорректный тип записи")
    if row.deadline_date is not None and row.deadline_date < row.issued_on:
        raise HTTPException(status_code=400, detail="Дедлайн не может быть раньше даты выдачи")
    if row.record_type == "interest_loan" and row.monthly_rate_percent is None:
        raise HTTPException(status_code=400, detail="Для кредита с процентом укажите ставку % в месяц")


@router.get("/lending", response_model=List[LendingRecordOut])
def list_lending(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_or_financier),
):
    slug = get_request_company()
    rows = (
        db.query(LendingRecord)
        .options(joinedload(LendingRecord.payment).joinedload(Payment.partner))
        .filter(LendingRecord.company_slug == slug)
        .order_by(LendingRecord.deadline_date.asc(), LendingRecord.id.asc())
        .all()
    )
    return [_to_out(r) for r in rows]


@router.post("/lending", response_model=LendingRecordOut)
def create_lending(
    body: LendingRecordCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_or_financier),
):
    slug = get_request_company()
    row = LendingRecord(
        company_slug=slug,
        entity_name=body.entity_name,
        payment_id=_validate_payment_id(db, body.payment_id),
        record_type=body.record_type,
        issued_on=body.issued_on,
        principal_uzs=body.principal_uzs,
        monthly_rate_percent=body.monthly_rate_percent,
        total_repayment_uzs=Decimal("0"),
        deadline_date=body.deadline_date,
        period_note=body.period_note,
        note=body.note,
    )
    _validate_row_rules(row)
    row.total_repayment_uzs = _calculated_total(row)[0]
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_out(row)


@router.put("/lending/{record_id}", response_model=LendingRecordOut)
def update_lending(
    record_id: int,
    body: LendingRecordUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_or_financier),
):
    slug = get_request_company()
    row = (
        db.query(LendingRecord)
        .filter(LendingRecord.id == record_id, LendingRecord.company_slug == slug)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    patch = body.model_dump(exclude_unset=True)
    if "payment_id" in patch:
        patch["payment_id"] = _validate_payment_id(db, patch["payment_id"])
    for key, val in patch.items():
        setattr(row, key, val)
    _validate_row_rules(row)
    row.total_repayment_uzs = _calculated_total(row)[0]
    db.commit()
    db.refresh(row)
    return _to_out(row)


@router.delete("/lending/{record_id}")
def delete_lending(
    record_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_or_financier),
):
    slug = get_request_company()
    row = (
        db.query(LendingRecord)
        .filter(LendingRecord.id == record_id, LendingRecord.company_slug == slug)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    db.delete(row)
    db.commit()
    return {"ok": True}
