"""Финансы: сводка по проектам (Projects Cost) из договоров и графика payment_months."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.core.access import filter_payments_query
from app.core.security import get_current_user, require_admin_or_financier
from app.db.database import get_db
from app.models.cash_flow import CashFlowEntry
from app.models.employee_payment_record import EmployeePaymentRecord
from app.models.partner import Partner
from app.models.payment import Payment, PaymentMonth
from app.models.user import User
from app.finance.cash_flow_catalog import expense_pl_bucket
from app.schemas.schemas import (
    PLCellOut,
    PLDataRowOut,
    PLReportOut,
    ProjectCostBreakdownPut,
    ProjectCostRowOut,
    ProjectCostScheduleMonthOut,
)

router = APIRouter(prefix="/api/finance", tags=["finance"])

_CATEGORY_SORT = {
    "web": 0,
    "ppc": 1,
    "seo": 2,
    "mobile_app": 3,
    "tech_support": 4,
    "hosting_domain": 5,
}


def _is_recurring_billing(p: Payment) -> bool:
    return p.payment_type in ("recurring", "service_expiry", "regular")


def _line_amount(pm: PaymentMonth, p: Payment) -> Decimal:
    if pm.amount is not None:
        return Decimal(str(pm.amount))
    return Decimal(str(p.amount))


def _payment_to_project_cost_row(p: Payment) -> ProjectCostRowOut:
    """Одна строка отчёта Projects Cost из загруженного Payment (partner + months)."""
    months_sorted = sorted(p.months or [], key=lambda x: x.month)
    sum_paid = Decimal("0")
    schedule_items: List[ProjectCostScheduleMonthOut] = []
    for pm in months_sorted:
        amt = _line_amount(pm, p)
        if pm.status == "paid":
            sum_paid += amt
        schedule_items.append(
            ProjectCostScheduleMonthOut(
                month=pm.month,
                amount=amt,
                status=pm.status,
                due_date=pm.due_date,
                paid_at=pm.paid_at,
                description=pm.description,
            )
        )

    if not months_sorted and p.status == "paid" and p.paid_at:
        sum_paid = Decimal(str(p.amount))

    rec = _is_recurring_billing(p)
    unit = Decimal(str(p.amount))
    contract_total: Decimal | None = None if rec else unit
    paid_pct: Decimal | None = None
    if not rec and contract_total is not None and contract_total > 0:
        paid_pct = (sum_paid / contract_total * Decimal(100)).quantize(Decimal("0.01"))
        if paid_pct > Decimal("100"):
            paid_pct = Decimal("100")

    started: date
    if isinstance(p.created_at, datetime):
        started = p.created_at.date()
    else:
        started = p.created_at  # type: ignore[assignment]

    if months_sorted:
        try:
            y_s, m_s = months_sorted[0].month.split("-")
            d0 = date(int(y_s), int(m_s), 1)
            if d0 < started:
                started = d0
        except (ValueError, IndexError):
            pass

    pm_name = None
    if p.partner and p.partner.manager:
        pm_name = p.partner.manager.name

    def _cz(attr: str) -> Decimal:
        v = getattr(p, attr, None)
        return Decimal(str(v)) if v is not None else Decimal("0")

    c_des = _cz("projects_cost_design_uzs")
    c_dev = _cz("projects_cost_dev_uzs")
    c_oth = _cz("projects_cost_other_uzs")
    c_seo = _cz("projects_cost_seo_uzs")
    internal = (c_des + c_dev + c_oth + c_seo).quantize(Decimal("0.01"))
    profit = (sum_paid - internal).quantize(Decimal("0.01"))

    return ProjectCostRowOut(
        payment_id=p.id,
        partner_id=p.partner_id,
        partner_name=(p.partner.name if p.partner else "") or "",
        project_name=(p.description or "").strip(),
        project_category=p.project_category,
        payment_type=p.payment_type,
        is_recurring_billing=rec,
        amount_basis="monthly" if rec else "contract_total",
        contract_total=contract_total,
        billing_unit_amount=unit,
        sum_paid_actual=sum_paid.quantize(Decimal("0.01")),
        paid_percent=paid_pct,
        pm_name=pm_name,
        project_start=started,
        schedule_months=schedule_items,
        cost_design_uzs=c_des.quantize(Decimal("0.01")),
        cost_dev_uzs=c_dev.quantize(Decimal("0.01")),
        cost_other_uzs=c_oth.quantize(Decimal("0.01")),
        cost_seo_uzs=c_seo.quantize(Decimal("0.01")),
        internal_cost_sum=internal,
        profit_actual=profit,
    )


@router.get("/projects-cost", response_model=List[ProjectCostRowOut])
def projects_cost_report(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Активные (не архивные) проекты с графиком месяцев.
    Рекуррент / сервис: в колонке «ставка» — сумма за период из договора (обычно месяц); % оплаты не считаем (как N/a в таблице).
    Разовый: контракт = payment.amount; факт = сумма оплаченных строк графика; % от контракта.
    """
    q = (
        db.query(Payment)
        .options(
            joinedload(Payment.partner).joinedload(Partner.manager),
            joinedload(Payment.months),
        )
        .filter(Payment.is_archived == False)
    )
    q = filter_payments_query(q, db, current_user)
    payments = q.all()

    def sort_key(pay: Payment) -> tuple:
        cat = pay.project_category or ""
        return (_CATEGORY_SORT.get(cat, 99), (pay.description or "").lower(), pay.id)

    payments_sorted = sorted(payments, key=sort_key)
    return [_payment_to_project_cost_row(p) for p in payments_sorted]


@router.put("/projects-cost/{payment_id}/cost-breakdown", response_model=ProjectCostRowOut)
def put_projects_cost_breakdown(
    payment_id: int,
    body: ProjectCostBreakdownPut,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_or_financier),
):
    """Разбивка себестоимости (дизайн / разработка / прочее / SEO) — сумма в колонке «Себест.»."""
    q = (
        db.query(Payment)
        .options(
            joinedload(Payment.partner).joinedload(Partner.manager),
            joinedload(Payment.months),
        )
        .filter(
            Payment.id == payment_id,
            Payment.is_archived == False,
            Payment.trashed_at.is_(None),
        )
    )
    q = filter_payments_query(q, db, current_user)
    p = q.first()
    if not p:
        raise HTTPException(status_code=404, detail="Проект не найден")
    p.projects_cost_design_uzs = body.cost_design_uzs
    p.projects_cost_dev_uzs = body.cost_dev_uzs
    p.projects_cost_other_uzs = body.cost_other_uzs
    p.projects_cost_seo_uzs = body.cost_seo_uzs
    db.commit()
    p = (
        db.query(Payment)
        .options(
            joinedload(Payment.partner).joinedload(Partner.manager),
            joinedload(Payment.months),
        )
        .filter(Payment.id == payment_id)
        .first()
    )
    return _payment_to_project_cost_row(p)


_REV_CATEGORY_LABELS: Dict[str, str] = {
    "web": "WEB",
    "ppc": "PPC",
    "seo": "SEO",
    "mobile_app": "Моб. приложения",
    "tech_support": "Поддержка",
    "hosting_domain": "Хостинг / домен",
    "uncategorized": "Без категории",
}

_REV_CATEGORY_ORDER = [
    "web",
    "ppc",
    "seo",
    "mobile_app",
    "tech_support",
    "hosting_domain",
    "uncategorized",
]


def _paid_month_index(pm: PaymentMonth, year: int) -> Optional[int]:
    """Номер месяца 1..12 для оплаченной строки графика в заданном году (кассовый месяц)."""
    if pm.status != "paid":
        return None
    if pm.paid_at is not None:
        dt = pm.paid_at
        d = dt.date() if isinstance(dt, datetime) else dt
        if d.year != year:
            return None
        return int(d.month)
    try:
        y_s, m_s = pm.month.split("-")
        yi, mi = int(y_s), int(m_s)
        if yi != year:
            return None
        return mi
    except (ValueError, AttributeError):
        return None


@router.get("/pl", response_model=PLReportOut)
def pl_report(
    year: Optional[int] = Query(None, ge=2000, le=2100, description="Календарный год отчёта"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    P&L по месяцам: выручка — оплаты по графику проектов (категории) + приходы из ДДС;
    расходы — команда + ДДС по статьям (в т.ч. отдельная строка «Агаси Д» для дивидендов).
    Итог: операционный результат без вывода Агаси Д; строка «Чистая прибыль» — только суммы категории Агаси Д/дивиденды из ДДС.
    """
    y = year if year is not None else date.today().year
    columns = [f"{y}-{str(m).zfill(2)}" for m in range(1, 13)]
    n = 12

    # --- Выручка по категориям проекта (UZS, проекты без валюты в БД) ---
    rev_by_cat: Dict[str, List[Decimal]] = {}
    q = (
        db.query(Payment)
        .options(joinedload(Payment.months))
        .filter(Payment.is_archived == False)
    )
    q = filter_payments_query(q, db, current_user)
    for p in q.all():
        cat = (p.project_category or "uncategorized").strip().lower() or "uncategorized"
        if cat not in rev_by_cat:
            rev_by_cat[cat] = [Decimal("0") for _ in range(n)]
        for pm in p.months or []:
            mi = _paid_month_index(pm, y)
            if mi is None:
                continue
            amt = _line_amount(pm, p)
            rev_by_cat[cat][mi - 1] += amt

    total_rev = [Decimal("0") for _ in range(n)]
    for vals in rev_by_cat.values():
        for i in range(n):
            total_rev[i] += vals[i]

    # --- ДДС (cash_flow_entries) за год ---
    cf_in_uzs = [Decimal("0") for _ in range(n)]
    cf_in_usd = [Decimal("0") for _ in range(n)]
    cf_sal_uzs = [Decimal("0") for _ in range(n)]
    cf_sal_usd = [Decimal("0") for _ in range(n)]
    cf_off_uzs = [Decimal("0") for _ in range(n)]
    cf_off_usd = [Decimal("0") for _ in range(n)]
    cf_acc_uzs = [Decimal("0") for _ in range(n)]
    cf_acc_usd = [Decimal("0") for _ in range(n)]
    cf_pub_uzs = [Decimal("0") for _ in range(n)]
    cf_pub_usd = [Decimal("0") for _ in range(n)]
    cf_tax_uzs = [Decimal("0") for _ in range(n)]
    cf_tax_usd = [Decimal("0") for _ in range(n)]
    cf_pb_uzs = [Decimal("0") for _ in range(n)]
    cf_pb_usd = [Decimal("0") for _ in range(n)]
    cf_mkt_uzs = [Decimal("0") for _ in range(n)]
    cf_mkt_usd = [Decimal("0") for _ in range(n)]
    cf_oth_uzs = [Decimal("0") for _ in range(n)]
    cf_oth_usd = [Decimal("0") for _ in range(n)]
    cf_agasi_uzs = [Decimal("0") for _ in range(n)]
    cf_agasi_usd = [Decimal("0") for _ in range(n)]

    for e in (
        db.query(CashFlowEntry)
        .filter(CashFlowEntry.period_month >= f"{y}-01")
        .filter(CashFlowEntry.period_month <= f"{y}-12")
        .all()
    ):
        try:
            ys, ms = e.period_month.split("-")
            if int(ys) != y:
                continue
            mi = int(ms)
            if mi < 1 or mi > 12:
                continue
            idx = mi - 1
        except (ValueError, AttributeError):
            continue
        au = Decimal(str(e.amount_uzs or 0))
        ad = Decimal(str(e.amount_usd or 0))
        if e.direction == "income":
            cf_in_uzs[idx] += au
            cf_in_usd[idx] += ad
            continue
        b = expense_pl_bucket(e.flow_category)
        if b == "salary":
            cf_sal_uzs[idx] += au
            cf_sal_usd[idx] += ad
        elif b == "office":
            cf_off_uzs[idx] += au
            cf_off_usd[idx] += ad
        elif b == "accounting":
            cf_acc_uzs[idx] += au
            cf_acc_usd[idx] += ad
        elif b == "publics":
            cf_pub_uzs[idx] += au
            cf_pub_usd[idx] += ad
        elif b == "taxes":
            cf_tax_uzs[idx] += au
            cf_tax_usd[idx] += ad
        elif b == "personal_brand":
            cf_pb_uzs[idx] += au
            cf_pb_usd[idx] += ad
        elif b == "marketing":
            cf_mkt_uzs[idx] += au
            cf_mkt_usd[idx] += ad
        elif b == "agasi_d":
            cf_agasi_uzs[idx] += au
            cf_agasi_usd[idx] += ad
        else:
            cf_oth_uzs[idx] += au
            cf_oth_usd[idx] += ad

    grand_rev_uzs = [total_rev[i] + cf_in_uzs[i] for i in range(n)]
    grand_rev_usd = [cf_in_usd[i] for i in range(n)]

    # --- Зарплатный фонд: админские выплаты сотрудникам (Команда) ---
    salary_uzs = [Decimal("0") for _ in range(n)]
    salary_usd = [Decimal("0") for _ in range(n)]
    payroll = (
        db.query(EmployeePaymentRecord)
        .filter(EmployeePaymentRecord.created_by_user_id.isnot(None))
        .filter(EmployeePaymentRecord.paid_on >= date(y, 1, 1))
        .filter(EmployeePaymentRecord.paid_on <= date(y, 12, 31))
        .all()
    )
    for r in payroll:
        m_idx = r.paid_on.month
        amt = Decimal(str(r.amount))
        cur = (r.currency or "UZS").upper()
        if cur == "USD":
            salary_usd[m_idx - 1] += amt
        else:
            salary_uzs[m_idx - 1] += amt

    rows: List[PLDataRowOut] = []

    # Выручка: строки по категориям (стабильный порядок + любые новые категории в конце)
    seen_extra = sorted(k for k in rev_by_cat if k not in _REV_CATEGORY_ORDER)
    ordered_cats = [c for c in _REV_CATEGORY_ORDER if c in rev_by_cat] + seen_extra

    for cat in ordered_cats:
        vals = rev_by_cat[cat]
        label = _REV_CATEGORY_LABELS.get(cat, cat.replace("_", " ").title())
        rows.append(
            PLDataRowOut(
                row_id=f"rev_{cat}",
                label=label,
                section="revenue",
                is_calculated=False,
                cells=[PLCellOut(uzs=vals[i].quantize(Decimal("0.01")), usd=Decimal("0")) for i in range(n)],
            )
        )

    rows.append(
        PLDataRowOut(
            row_id="rev_cf_income",
            label="Дополнительный приход (ДДС)",
            section="revenue",
            is_calculated=False,
            cells=[
                PLCellOut(
                    uzs=cf_in_uzs[i].quantize(Decimal("0.01")),
                    usd=cf_in_usd[i].quantize(Decimal("0.01")),
                )
                for i in range(n)
            ],
        )
    )

    rows.append(
        PLDataRowOut(
            row_id="rev_grand_total",
            label="Итого выручка (проекты + ДДС)",
            section="revenue",
            is_calculated=True,
            cells=[
                PLCellOut(
                    uzs=grand_rev_uzs[i].quantize(Decimal("0.01")),
                    usd=grand_rev_usd[i].quantize(Decimal("0.01")),
                )
                for i in range(n)
            ],
        )
    )

    merged_sal_uzs = [salary_uzs[i] + cf_sal_uzs[i] for i in range(n)]
    merged_sal_usd = [salary_usd[i] + cf_sal_usd[i] for i in range(n)]

    rows.append(
        PLDataRowOut(
            row_id="exp_payroll_total",
            label="Зарплатный фонд (команда + ДДС)",
            section="expenses_fixed",
            is_calculated=False,
            cells=[
                PLCellOut(
                    uzs=merged_sal_uzs[i].quantize(Decimal("0.01")),
                    usd=merged_sal_usd[i].quantize(Decimal("0.01")),
                )
                for i in range(n)
            ],
        )
    )

    rows.append(
        PLDataRowOut(
            row_id="exp_cf_office",
            label="Офис (ДДС)",
            section="expenses_fixed",
            is_calculated=False,
            cells=[
                PLCellOut(
                    uzs=cf_off_uzs[i].quantize(Decimal("0.01")),
                    usd=cf_off_usd[i].quantize(Decimal("0.01")),
                )
                for i in range(n)
            ],
        )
    )

    rows.append(
        PLDataRowOut(
            row_id="exp_cf_accounting",
            label="Бухгалтерия (ДДС)",
            section="expenses_fixed",
            is_calculated=False,
            cells=[
                PLCellOut(
                    uzs=cf_acc_uzs[i].quantize(Decimal("0.01")),
                    usd=cf_acc_usd[i].quantize(Decimal("0.01")),
                )
                for i in range(n)
            ],
        )
    )

    rows.append(
        PLDataRowOut(
            row_id="exp_cf_publics",
            label="Паблики (ДДС)",
            section="expenses_fixed",
            is_calculated=False,
            cells=[
                PLCellOut(
                    uzs=cf_pub_uzs[i].quantize(Decimal("0.01")),
                    usd=cf_pub_usd[i].quantize(Decimal("0.01")),
                )
                for i in range(n)
            ],
        )
    )

    rows.append(
        PLDataRowOut(
            row_id="exp_cf_taxes",
            label="Налоги (ДДС)",
            section="expenses_fixed",
            is_calculated=False,
            cells=[
                PLCellOut(
                    uzs=cf_tax_uzs[i].quantize(Decimal("0.01")),
                    usd=cf_tax_usd[i].quantize(Decimal("0.01")),
                )
                for i in range(n)
            ],
        )
    )

    rows.append(
        PLDataRowOut(
            row_id="exp_cf_personal_brand",
            label="Личный бренд (ДДС)",
            section="expenses_fixed",
            is_calculated=False,
            cells=[
                PLCellOut(
                    uzs=cf_pb_uzs[i].quantize(Decimal("0.01")),
                    usd=cf_pb_usd[i].quantize(Decimal("0.01")),
                )
                for i in range(n)
            ],
        )
    )

    rows.append(
        PLDataRowOut(
            row_id="exp_cf_marketing",
            label="Маркетинг (ДДС)",
            section="expenses_fixed",
            is_calculated=False,
            cells=[
                PLCellOut(
                    uzs=cf_mkt_uzs[i].quantize(Decimal("0.01")),
                    usd=cf_mkt_usd[i].quantize(Decimal("0.01")),
                )
                for i in range(n)
            ],
        )
    )

    rows.append(
        PLDataRowOut(
            row_id="exp_cf_agasi_d",
            label="Агаси Д (дивиденды, ДДС)",
            section="expenses_fixed",
            is_calculated=False,
            cells=[
                PLCellOut(
                    uzs=cf_agasi_uzs[i].quantize(Decimal("0.01")),
                    usd=cf_agasi_usd[i].quantize(Decimal("0.01")),
                )
                for i in range(n)
            ],
        )
    )

    rows.append(
        PLDataRowOut(
            row_id="exp_cf_other",
            label="Прочие расходы (ДДС)",
            section="expenses_fixed",
            is_calculated=False,
            cells=[
                PLCellOut(
                    uzs=cf_oth_uzs[i].quantize(Decimal("0.01")),
                    usd=cf_oth_usd[i].quantize(Decimal("0.01")),
                )
                for i in range(n)
            ],
        )
    )

    exp_total_uzs = [
        merged_sal_uzs[i]
        + cf_off_uzs[i]
        + cf_acc_uzs[i]
        + cf_pub_uzs[i]
        + cf_tax_uzs[i]
        + cf_pb_uzs[i]
        + cf_mkt_uzs[i]
        + cf_agasi_uzs[i]
        + cf_oth_uzs[i]
        for i in range(n)
    ]
    exp_total_usd = [
        merged_sal_usd[i]
        + cf_off_usd[i]
        + cf_acc_usd[i]
        + cf_pub_usd[i]
        + cf_tax_usd[i]
        + cf_pb_usd[i]
        + cf_mkt_usd[i]
        + cf_agasi_usd[i]
        + cf_oth_usd[i]
        for i in range(n)
    ]

    rows.append(
        PLDataRowOut(
            row_id="exp_total",
            label="Итого расходы (учтено)",
            section="expenses_fixed",
            is_calculated=True,
            cells=[
                PLCellOut(
                    uzs=exp_total_uzs[i].quantize(Decimal("0.01")),
                    usd=exp_total_usd[i].quantize(Decimal("0.01")),
                )
                for i in range(n)
            ],
        )
    )

    exp_operating_uzs = [exp_total_uzs[i] - cf_agasi_uzs[i] for i in range(n)]
    exp_operating_usd = [exp_total_usd[i] - cf_agasi_usd[i] for i in range(n)]
    operating_uzs = [grand_rev_uzs[i] - exp_operating_uzs[i] for i in range(n)]
    operating_usd = [grand_rev_usd[i] - exp_operating_usd[i] for i in range(n)]

    rows.append(
        PLDataRowOut(
            row_id="operating_profit",
            label="Операционный результат (выручка − расходы без Агаси Д)",
            section="summary",
            is_calculated=True,
            cells=[
                PLCellOut(
                    uzs=operating_uzs[i].quantize(Decimal("0.01")),
                    usd=operating_usd[i].quantize(Decimal("0.01")),
                )
                for i in range(n)
            ],
        )
    )

    rows.append(
        PLDataRowOut(
            row_id="net_profit",
            label="Чистая прибыль (Агаси Д — суммы из ДДС)",
            section="summary",
            is_calculated=True,
            cells=[
                PLCellOut(
                    uzs=cf_agasi_uzs[i].quantize(Decimal("0.01")),
                    usd=cf_agasi_usd[i].quantize(Decimal("0.01")),
                )
                for i in range(n)
            ],
        )
    )

    return PLReportOut(year=y, columns=columns, rows=rows)
