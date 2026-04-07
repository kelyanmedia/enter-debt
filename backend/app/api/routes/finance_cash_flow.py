"""ДДС: шаблоны месяца, строки приход/расход, справочники."""
from __future__ import annotations

import re
from decimal import Decimal
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.core.access import filter_payments_query
from app.core.security import require_admin_or_financier, require_cash_flow_dds_input
from app.db.database import get_db, get_request_company
from sqlalchemy import func

from app.finance.cash_flow_catalog import (
    EXPENSE_CATEGORY_LABELS,
    INCOME_CATEGORY_LABELS,
    expense_categories_for_api,
    income_categories_for_api,
    PAYMENT_METHODS,
)
from app.models.cash_flow import CashFlowEntry, CashFlowTemplateLine
from app.models.payment import Payment
from app.models.user import User
from app.models.available_funds_manual import AvailableFundsManual
from app.schemas.schemas import (
    ApplyCashFlowTemplateIn,
    AvailableFundsManualPut,
    AvailableFundsOut,
    CashFlowEntryCreate,
    CashFlowEntryOut,
    CashFlowEntryUpdate,
    CashFlowMetaOut,
    CashFlowPaymentOptionOut,
    CashFlowTemplateLineCreate,
    CashFlowTemplateLineOut,
    CashFlowTemplateLineUpdate,
)
from app.services.available_funds import available_funds_for_period


def _check_expense_category(slug: str | None) -> None:
    if not slug or not str(slug).strip():
        return
    s = str(slug).strip().lower()
    if s not in EXPENSE_CATEGORY_LABELS:
        raise HTTPException(
            status_code=400,
            detail=f"Неизвестная категория расхода «{slug}». Выберите из справочника в панели.",
        )


def _check_income_category(slug: str | None) -> None:
    if not slug or not str(slug).strip():
        raise HTTPException(status_code=400, detail="Укажите категорию прихода")
    s = str(slug).strip().lower()
    if s not in INCOME_CATEGORY_LABELS:
        raise HTTPException(
            status_code=400,
            detail=f"Неизвестная категория прихода «{slug}». Выберите из справочника.",
        )


_TEMPLATE_GROUP_LABELS: dict[str, str] = {
    "monthly_salary": "Зарплаты (шаблон месяца)",
    "monthly_admin": "Административные (шаблон)",
}

router = APIRouter(prefix="/api/finance", tags=["finance"])

_YM = re.compile(r"^\d{4}-\d{2}$")


def _pl_fx_rate_for_period(db: Session, period_month: str) -> Decimal:
    row = (
        db.query(AvailableFundsManual)
        .filter(
            AvailableFundsManual.period_month == period_month,
            AvailableFundsManual.company_slug == get_request_company(),
        )
        .first()
    )
    return Decimal(str(row.usd_to_uzs_rate or 0)) if row else Decimal("0")


@router.get("/cash-flow/meta", response_model=CashFlowMetaOut)
def cash_flow_meta(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_cash_flow_dds_input),
):
    distinct = (
        db.query(CashFlowTemplateLine.template_group)
        .filter(CashFlowTemplateLine.company_slug == get_request_company())
        .distinct()
        .order_by(CashFlowTemplateLine.template_group)
        .all()
    )
    template_groups: List[dict] = []
    for (gid,) in distinct:
        template_groups.append(
            {
                "id": gid,
                "label": _TEMPLATE_GROUP_LABELS.get(gid, gid),
                "description": "",
            }
        )
    if current_user.role == "administration":
        template_groups = []
    return CashFlowMetaOut(
        payment_methods=[{"id": a, "label": b} for a, b in PAYMENT_METHODS],
        expense_categories=expense_categories_for_api(),
        income_categories=income_categories_for_api(),
        template_groups=template_groups,
    )


@router.get("/cash-flow/fx-rate")
def cash_flow_fx_rate(
    period_month: str = Query(..., description="YYYY-MM"),
    db: Session = Depends(get_db),
    _user: User = Depends(require_cash_flow_dds_input),
):
    if not _YM.match(period_month):
        raise HTTPException(status_code=400, detail="period_month: формат YYYY-MM")
    return {
        "period_month": period_month,
        "usd_to_uzs_rate": _pl_fx_rate_for_period(db, period_month),
    }


@router.get("/cash-flow/templates", response_model=List[CashFlowTemplateLineOut])
def list_templates(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin_or_financier),
):
    rows = (
        db.query(CashFlowTemplateLine)
        .filter(CashFlowTemplateLine.company_slug == get_request_company())
        .order_by(CashFlowTemplateLine.template_group, CashFlowTemplateLine.sort_order, CashFlowTemplateLine.id)
        .all()
    )
    return rows


@router.post("/cash-flow/templates", response_model=CashFlowTemplateLineOut)
def create_template_line(
    body: CashFlowTemplateLineCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin_or_financier),
):
    tg = body.template_group.strip()
    if body.direction == "expense":
        _check_expense_category(body.flow_category)
    else:
        _check_income_category(body.flow_category)
    mx = (
        db.query(func.max(CashFlowTemplateLine.sort_order))
        .filter(
            CashFlowTemplateLine.template_group == tg,
            CashFlowTemplateLine.company_slug == get_request_company(),
        )
        .scalar()
    )
    so = (
        body.sort_order
        if body.sort_order is not None
        else (int(mx) if mx is not None else 0) + 1
    )
    row = CashFlowTemplateLine(
        company_slug=get_request_company(),
        template_group=tg,
        sort_order=so,
        label=body.label.strip(),
        default_amount_uzs=body.default_amount_uzs,
        default_amount_usd=body.default_amount_usd,
        flow_category=str(body.flow_category).strip().lower(),
        payment_method=body.payment_method,
        direction=body.direction,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/cash-flow/templates/{template_id}", response_model=CashFlowTemplateLineOut)
def update_template_line(
    template_id: int,
    body: CashFlowTemplateLineUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin_or_financier),
):
    row = (
        db.query(CashFlowTemplateLine)
        .filter(
            CashFlowTemplateLine.id == template_id,
            CashFlowTemplateLine.company_slug == get_request_company(),
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Строка шаблона не найдена")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        if k == "template_group" and v is not None:
            setattr(row, k, str(v).strip())
        elif k == "label" and v is not None:
            setattr(row, k, str(v).strip())
        elif k == "flow_category" and v is not None:
            setattr(row, k, str(v).strip().lower())
        else:
            setattr(row, k, v)
    direction = row.direction
    cat = row.flow_category
    if direction == "expense":
        _check_expense_category(cat)
    else:
        _check_income_category(cat)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/cash-flow/templates/{template_id}")
def delete_template_line(
    template_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin_or_financier),
):
    row = (
        db.query(CashFlowTemplateLine)
        .filter(
            CashFlowTemplateLine.id == template_id,
            CashFlowTemplateLine.company_slug == get_request_company(),
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Строка шаблона не найдена")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.delete("/cash-flow/template-group")
def delete_template_group(
    template_group: str = Query(..., min_length=1, max_length=40),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin_or_financier),
):
    q = db.query(CashFlowTemplateLine).filter(
        CashFlowTemplateLine.template_group == template_group,
        CashFlowTemplateLine.company_slug == get_request_company(),
    )
    n = q.delete(synchronize_session=False)
    db.commit()
    return {"ok": True, "deleted": n}


@router.get("/cash-flow/entries", response_model=List[CashFlowEntryOut])
def list_entries(
    period_month: str = Query(..., description="YYYY-MM"),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin_or_financier),
):
    if not _YM.match(period_month):
        raise HTTPException(status_code=400, detail="period_month: формат YYYY-MM")
    return (
        db.query(CashFlowEntry)
        .filter(
            CashFlowEntry.period_month == period_month,
            CashFlowEntry.company_slug == get_request_company(),
        )
        .order_by(CashFlowEntry.direction.desc(), CashFlowEntry.id)
        .all()
    )


@router.get("/cash-flow/payment-options", response_model=List[CashFlowPaymentOptionOut])
def payment_options(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin_or_financier),
):
    q = db.query(Payment).options(joinedload(Payment.partner)).filter(Payment.is_archived == False)
    q = filter_payments_query(q, db, _admin)
    payments = q.order_by(Payment.description).limit(500).all()
    out: List[CashFlowPaymentOptionOut] = []
    for p in payments:
        pn = (p.partner.name if p.partner else "") or ""
        out.append(
            CashFlowPaymentOptionOut(
                id=p.id,
                label=(p.description or "").strip() or f"Проект #{p.id}",
                partner_name=pn,
            )
        )
    return out


@router.post("/cash-flow/apply-template", response_model=List[CashFlowEntryOut])
def apply_template(
    body: ApplyCashFlowTemplateIn,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin_or_financier),
):
    empty: List[str] = []
    for g in body.template_groups:
        n = (
            db.query(CashFlowTemplateLine)
            .filter(
                CashFlowTemplateLine.template_group == g,
                CashFlowTemplateLine.company_slug == get_request_company(),
            )
            .count()
        )
        if n == 0:
            empty.append(g)
    if empty:
        raise HTTPException(
            status_code=400,
            detail=f"В группах нет строк шаблона: {empty}",
        )

    tpls = (
        db.query(CashFlowTemplateLine)
        .filter(
            CashFlowTemplateLine.template_group.in_(body.template_groups),
            CashFlowTemplateLine.company_slug == get_request_company(),
        )
        .order_by(CashFlowTemplateLine.template_group, CashFlowTemplateLine.sort_order)
        .all()
    )
    created: List[CashFlowEntry] = []
    for t in tpls:
        row = CashFlowEntry(
            company_slug=get_request_company(),
            period_month=body.period_month,
            direction=t.direction,
            label=t.label,
            amount_uzs=t.default_amount_uzs,
            amount_usd=t.default_amount_usd,
            apply_fx_to_uzs=False,
            payment_method=t.payment_method,
            flow_category=t.flow_category,
            recipient=None,
            payment_id=None,
            notes=None,
            template_line_id=t.id,
        )
        db.add(row)
        created.append(row)
    db.commit()
    for r in created:
        db.refresh(r)
    return created


@router.post("/cash-flow/entries", response_model=CashFlowEntryOut)
def create_entry(
    body: CashFlowEntryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_cash_flow_dds_input),
):
    pay_id = body.payment_id
    if pay_id is not None and pay_id <= 0:
        pay_id = None
    if current_user.role == "administration":
        pay_id = None
    if pay_id is not None:
        p = (
            db.query(Payment)
            .filter(
                Payment.id == pay_id,
                Payment.company_slug == get_request_company(),
            )
            .first()
        )
        if not p or p.trashed_at is not None:
            raise HTTPException(status_code=404, detail="Проект не найден")
    if body.direction == "expense":
        _check_expense_category(body.flow_category)
    else:
        _check_income_category(body.flow_category)
    if body.entry_date is not None:
        period_month = f"{body.entry_date.year:04d}-{body.entry_date.month:02d}"
        entry_date_val = body.entry_date
    else:
        period_month = body.period_month
        if not period_month:
            raise HTTPException(status_code=400, detail="Укажите месяц учёта или дату операции")
        entry_date_val = None
    row = CashFlowEntry(
        company_slug=get_request_company(),
        period_month=period_month,
        entry_date=entry_date_val,
        direction=body.direction,
        label=body.label.strip(),
        amount_uzs=body.amount_uzs,
        amount_usd=body.amount_usd,
        apply_fx_to_uzs=bool(body.apply_fx_to_uzs),
        payment_method=body.payment_method,
        flow_category=(body.flow_category or "").strip() or None,
        recipient=(body.recipient or "").strip() or None,
        payment_id=pay_id,
        notes=(body.notes or "").strip() or None,
        template_line_id=None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/cash-flow/entries/{entry_id}", response_model=CashFlowEntryOut)
def update_entry(
    entry_id: int,
    body: CashFlowEntryUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin_or_financier),
):
    row = (
        db.query(CashFlowEntry)
        .filter(
            CashFlowEntry.id == entry_id,
            CashFlowEntry.company_slug == get_request_company(),
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Строка не найдена")
    data = body.model_dump(exclude_unset=True)
    if "payment_id" in data:
        pid = data["payment_id"]
        if pid is not None and pid <= 0:
            data["payment_id"] = None
            pid = None
        if pid is not None:
            p = (
                db.query(Payment)
                .filter(
                    Payment.id == pid,
                    Payment.company_slug == get_request_company(),
                )
                .first()
            )
            if not p or p.trashed_at is not None:
                raise HTTPException(status_code=404, detail="Проект не найден")
    for k, v in data.items():
        setattr(row, k, v)
    if row.direction == "expense":
        _check_expense_category(row.flow_category)
    else:
        _check_income_category(row.flow_category)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/cash-flow/entries/{entry_id}")
def delete_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin_or_financier),
):
    row = (
        db.query(CashFlowEntry)
        .filter(
            CashFlowEntry.id == entry_id,
            CashFlowEntry.company_slug == get_request_company(),
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Строка не найдена")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/available-funds", response_model=AvailableFundsOut)
def get_available_funds(
    period_month: str = Query(..., description="YYYY-MM"),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin_or_financier),
):
    if not _YM.match(period_month):
        raise HTTPException(status_code=400, detail="period_month: формат YYYY-MM")
    return available_funds_for_period(db, period_month)


@router.put("/available-funds", response_model=AvailableFundsOut)
def put_available_funds_deposits(
    body: AvailableFundsManualPut,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin_or_financier),
):
    row = (
        db.query(AvailableFundsManual)
        .filter(
            AvailableFundsManual.period_month == body.period_month,
            AvailableFundsManual.company_slug == get_request_company(),
        )
        .first()
    )
    if not row:
        row = AvailableFundsManual(
            company_slug=get_request_company(),
            period_month=body.period_month,
            deposits_uzs=body.deposits_uzs,
            adjust_account_uzs=body.adjust_account_uzs,
            adjust_cards_uzs=body.adjust_cards_uzs,
            usd_to_uzs_rate=body.usd_to_uzs_rate,
        )
        db.add(row)
    else:
        row.deposits_uzs = body.deposits_uzs
        row.adjust_account_uzs = body.adjust_account_uzs
        row.adjust_cards_uzs = body.adjust_cards_uzs
        row.usd_to_uzs_rate = body.usd_to_uzs_rate
    db.commit()
    db.refresh(row)
    return available_funds_for_period(db, body.period_month)
