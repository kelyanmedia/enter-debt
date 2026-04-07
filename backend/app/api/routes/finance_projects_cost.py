"""Финансы: сводка по проектам (Projects Cost) из договоров и графика payment_months."""
from __future__ import annotations

import re
from calendar import monthrange
from datetime import date, datetime
from decimal import Decimal
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, or_
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.orm import Session, joinedload

from app.core.access import filter_payments_query
from app.core.security import get_current_user, require_admin_or_financier
from app.db.database import get_db, get_request_company
from app.models.available_funds_manual import AvailableFundsManual
from app.models.cash_flow import CashFlowEntry
from app.models.commission import Commission
from app.models.employee_payment_record import EmployeePaymentRecord
from app.models.partner import Partner
from app.models.payment import Payment, PaymentMonth
from app.models.user import User
from app.models.pl_manual_line import PlManualLine, PlManualMonthCell
from app.models.employee_task import EmployeeTask
from app.finance.cash_flow_catalog import expense_pl_bucket
from app.schemas.schemas import (
    PLCellOut,
    PLDataRowOut,
    PLReportOut,
    PLManualLineCreate,
    PLManualLineUpdate,
    PLManualLineOut,
    PLManualCellPut,
    ProjectCostBreakdownPut,
    ProjectCostRowOut,
    ProjectCostScheduleMonthOut,
)

router = APIRouter(prefix="/api/finance", tags=["finance"])
# Если nginx отрезает префикс /api (см. main.py), клиент шлёт на /finance/... — дублируем ручные строки P&L.
router_finance_no_api_prefix = APIRouter(prefix="/finance", tags=["finance"])

_CATEGORY_SORT = {
    "smm": 0,
    "target": 1,
    "personal_brand": 2,
    "content": 3,
    "web": 10,
    "ppc": 11,
    "seo": 12,
    "mobile_app": 13,
    "tech_support": 14,
    "events": 15,
    "hosting_domain": 20,
}

_YM_RE = re.compile(r"^\d{4}-\d{2}$")


def _payment_created_date(p: Payment) -> date:
    ca = p.created_at
    if isinstance(ca, datetime):
        return ca.date()
    return ca  # type: ignore[return-value]


def _norm_month_bounds(
    month_from: Optional[str], month_to: Optional[str]
) -> Optional[Tuple[str, str]]:
    """Один или оба YYYY-MM; инклюзивный диапазон; при одном параметре — один месяц."""
    mf = (month_from or "").strip()
    mt = (month_to or "").strip()
    if not mf and not mt:
        return None
    a = mf or mt
    b = mt or mf
    if not _YM_RE.match(a) or not _YM_RE.match(b):
        raise HTTPException(
            status_code=400,
            detail="Параметры month_from и month_to должны быть в формате YYYY-MM",
        )
    if a > b:
        a, b = b, a
    return (a, b)


def _first_calendar_day_of_ym(ym: str) -> date:
    y, m = map(int, ym.split("-"))
    return date(y, m, 1)


def _last_calendar_day_of_ym(ym: str) -> date:
    y, m = map(int, ym.split("-"))
    return date(y, m, monthrange(y, m)[1])


def _sort_payment_month_lines(months: Optional[List[PaymentMonth]]) -> List[PaymentMonth]:
    return sorted(months or [], key=lambda x: (x.month, x.id))


def _payment_work_span(p: Payment) -> Tuple[date, Optional[date]]:
    """
    Интервал активной работы [start, end] включительно.
    Начало — дата создания проекта и не раньше 1-го числа первого месяца графика (как в колонке «Начало»).
    Конец — deadline_date проекта; иначе макс. due_date по строкам графика; иначе последний день последнего месяца графика.
    Если графика нет, end остаётся None (используется запасная логика по месяцу создания/оплаты).
    """
    months_sorted = _sort_payment_month_lines(p.months)
    work_lo = _payment_created_date(p)
    if months_sorted:
        try:
            ys, ms = months_sorted[0].month.split("-")
            d0 = date(int(ys), int(ms), 1)
            if d0 < work_lo:
                work_lo = d0
        except (ValueError, IndexError):
            pass

    work_hi: Optional[date] = None
    if getattr(p, "deadline_date", None) is not None:
        work_hi = p.deadline_date
    elif months_sorted:
        due_dates = [pm.due_date for pm in months_sorted if pm.due_date is not None]
        if due_dates:
            work_hi = max(due_dates)
        else:
            try:
                work_hi = _last_calendar_day_of_ym(months_sorted[-1].month)
            except (ValueError, IndexError):
                work_hi = None
    return work_lo, work_hi


def _payment_overlaps_month_window(p: Payment, mf: str, mt: str) -> bool:
    """
    Проект в выбранном периоде календарных месяцев [mf..mt], если интервал работы пересекает
    объединение этих месяцев (напр. работа 20 янв — 20 апр видна в апреле, но не в мае).
    Без известного конца работы — по графику: любой месяц строки в [mf, mt]; без графика — месяц создания/оплаты.
    """
    window_lo = _first_calendar_day_of_ym(mf)
    window_hi = _last_calendar_day_of_ym(mt)
    months_sorted = _sort_payment_month_lines(p.months)
    work_lo, work_hi = _payment_work_span(p)

    if work_hi is not None:
        return work_lo <= window_hi and window_lo <= work_hi

    if months_sorted:
        for pm in months_sorted:
            if mf <= pm.month <= mt:
                return True
        return False
    ym0 = f"{work_lo.year}-{work_lo.month:02d}"
    if mf <= ym0 <= mt:
        return True
    if p.paid_at:
        pad = p.paid_at
        d = pad.date() if isinstance(pad, datetime) else pad
        ym1 = f"{d.year}-{d.month:02d}"
        if mf <= ym1 <= mt:
            return True
    return False


def _is_recurring_billing(p: Payment) -> bool:
    return p.payment_type in ("recurring", "service_expiry", "regular")


def _line_amount(pm: PaymentMonth, p: Payment) -> Decimal:
    if pm.amount is not None:
        return Decimal(str(pm.amount))
    return Decimal(str(p.amount))


_TASK_COST_CATS = frozenset({"design", "dev", "other", "seo"})


def _task_allocated_cost_uzs_by_payment(db: Session) -> Dict[int, Dict[str, Decimal]]:
    """(amount − budget) в UZS по payment_id и статье; USD по курсу месяца work_date из «Доступные средства»."""
    rates = {
        r.period_month: Decimal(str(r.usd_to_uzs_rate or 0))
        for r in db.query(AvailableFundsManual)
        .filter(AvailableFundsManual.company_slug == get_request_company())
        .all()
    }
    out: Dict[int, Dict[str, Decimal]] = {}
    for t in (
        db.query(EmployeeTask)
        .filter(EmployeeTask.allocated_payment_id.isnot(None))
        .filter(EmployeeTask.cost_category.isnot(None))
        .filter(EmployeeTask.company_slug == get_request_company())
        .all()
    ):
        cat = (t.cost_category or "").strip().lower()
        if cat not in _TASK_COST_CATS:
            continue
        amt = Decimal(str(t.amount or 0))
        bud = Decimal(str(t.budget_amount or 0))
        net = amt - bud
        if net <= 0:
            continue
        ym = f"{t.work_date.year}-{str(t.work_date.month).zfill(2)}"
        cur = (t.currency or "USD").upper()
        if cur == "USD":
            rfx = rates.get(ym) or Decimal(0)
            if rfx <= 0:
                continue
            net_uzs = (net * rfx).quantize(Decimal("0.01"))
        else:
            net_uzs = net.quantize(Decimal("0.01"))
        pid = int(t.allocated_payment_id)  # type: ignore[arg-type]
        if pid not in out:
            out[pid] = {k: Decimal(0) for k in _TASK_COST_CATS}
        out[pid][cat] = out[pid][cat] + net_uzs
    return out


def _commission_percent_by_payment_id(db: Session) -> Dict[int, Decimal]:
    """Последняя по id комиссия с привязкой к payment_id → % менеджера для Projects Cost."""
    rows = (
        db.query(Commission.payment_id, Commission.manager_percent, Commission.id)
        .filter(Commission.payment_id.isnot(None))
        .filter(Commission.company_slug == get_request_company())
        .order_by(Commission.id.desc())
        .all()
    )
    out: Dict[int, Decimal] = {}
    for pid, pct, _i in rows:
        if pid not in out:
            out[int(pid)] = Decimal(str(pct))
    return out


def _payment_to_project_cost_row(
    p: Payment,
    manager_commission_percent: Optional[Decimal] = None,
    task_alloc: Optional[Dict[str, Decimal]] = None,
) -> ProjectCostRowOut:
    """Одна строка отчёта Projects Cost из загруженного Payment (partner + months)."""
    months_sorted = _sort_payment_month_lines(p.months)
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

    ta = task_alloc or {}
    td = ta.get("design", Decimal(0))
    tv = ta.get("dev", Decimal(0))
    to = ta.get("other", Decimal(0))
    ts = ta.get("seo", Decimal(0))
    m_des = _cz("projects_cost_design_uzs")
    m_dev = _cz("projects_cost_dev_uzs")
    m_oth = _cz("projects_cost_other_uzs")
    m_seo = _cz("projects_cost_seo_uzs")
    c_des = m_des + td
    c_dev = m_dev + tv
    c_oth = m_oth + to
    c_seo = m_seo + ts
    internal = (c_des + c_dev + c_oth + c_seo).quantize(Decimal("0.01"))
    profit = (sum_paid - internal).quantize(Decimal("0.01"))

    mcp = None
    reserved: Optional[Decimal] = None
    profit_after = profit
    if manager_commission_percent is not None:
        mcp = Decimal(str(manager_commission_percent)).quantize(Decimal("0.01"))
        if mcp > 0 and profit > 0:
            reserved = (profit * mcp / Decimal(100)).quantize(Decimal("0.01"))
            profit_after = (profit - reserved).quantize(Decimal("0.01"))
        else:
            reserved = Decimal("0")

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
        cost_design_manual_uzs=m_des.quantize(Decimal("0.01")),
        cost_dev_manual_uzs=m_dev.quantize(Decimal("0.01")),
        cost_other_manual_uzs=m_oth.quantize(Decimal("0.01")),
        cost_seo_manual_uzs=m_seo.quantize(Decimal("0.01")),
        tasks_cost_design_uzs=td.quantize(Decimal("0.01")),
        tasks_cost_dev_uzs=tv.quantize(Decimal("0.01")),
        tasks_cost_other_uzs=to.quantize(Decimal("0.01")),
        tasks_cost_seo_uzs=ts.quantize(Decimal("0.01")),
        internal_cost_sum=internal,
        profit_actual=profit,
        manager_commission_percent=mcp,
        manager_commission_reserved_uzs=reserved,
        profit_after_manager_uzs=profit_after,
    )


@router.get("/projects-cost", response_model=List[ProjectCostRowOut])
def projects_cost_report(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    month_from: Optional[str] = Query(
        None,
        description="Начало периода YYYY-MM (включительно). С month_to — фильтр проектов по пересечению с графиком/датами.",
    ),
    month_to: Optional[str] = Query(
        None,
        description="Конец периода YYYY-MM (включительно).",
    ),
):
    """
    Активные (не архивные) проекты с графиком месяцев.
    Рекуррент / сервис: в колонке «ставка» — сумма за период из договора (обычно месяц); % оплаты не считаем (как N/a в таблице).
    Разовый: контракт = payment.amount; факт = сумма оплаченных строк графика; % от контракта.
    При month_from/month_to остаются проекты, у которых интервал работы (от «Начала» до дедлайна или конца графика)
    пересекает выбранные календарные месяцы. Без дедлайна и без дат в графике — по месяцам строк графика или дате создания/оплаты.
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
    bounds = _norm_month_bounds(month_from, month_to)
    if bounds:
        mf, mt = bounds
        payments_sorted = [p for p in payments_sorted if _payment_overlaps_month_window(p, mf, mt)]
    pct_map = _commission_percent_by_payment_id(db)
    task_amap = _task_allocated_cost_uzs_by_payment(db)
    return [
        _payment_to_project_cost_row(p, pct_map.get(p.id), task_amap.get(p.id)) for p in payments_sorted
    ]


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
        .filter(
            Payment.id == payment_id,
            Payment.company_slug == get_request_company(),
        )
        .first()
    )
    pct_map = _commission_percent_by_payment_id(db)
    task_amap = _task_allocated_cost_uzs_by_payment(db)
    return _payment_to_project_cost_row(p, pct_map.get(p.id), task_amap.get(p.id))


_REV_CATEGORY_LABELS: Dict[str, str] = {
    "smm": "SMM",
    "target": "Таргет",
    "personal_brand": "Личный бренд",
    "content": "Контент",
    "web": "WEB",
    "ppc": "PPC",
    "seo": "SEO",
    "mobile_app": "Моб. приложения",
    "tech_support": "Поддержка",
    "events": "Ивенты",
    "hosting_domain": "Хостинг / домен",
    "uncategorized": "Без категории",
}

_REV_CATEGORY_ORDER = [
    "smm",
    "target",
    "personal_brand",
    "content",
    "web",
    "ppc",
    "seo",
    "mobile_app",
    "tech_support",
    "events",
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


def _employee_payment_pl_month_index(r: EmployeePaymentRecord, report_year: int) -> Optional[int]:
    """
    Номер месяца 1..12 в колонках P&L за report_year.
    Если задан период начисления (год+месяц) — он; иначе месяц даты выплаты (касса).
    """
    py, pm = r.period_year, r.period_month
    if py is not None and pm is not None and 1 <= int(pm) <= 12:
        if int(py) != report_year:
            return None
        return int(pm)
    d = r.paid_on
    if d.year != report_year:
        return None
    return int(d.month)


@router.get("/pl", response_model=PLReportOut)
def pl_report(
    year: Optional[int] = Query(None, ge=2000, le=2100, description="Календарный год отчёта"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    P&L по месяцам: выручка — оплаты по графику проектов (категории) + приходы из ДДС;
    расходы — команда + ДДС по статьям + ручные строки.
    Суммы в USD (строки ДДС, выплаты команде в долларах) при заданном в ДДС курсе за соответствующий месяц
    (usd_to_uzs_rate в «Доступные средства») переводятся в сумы и попадают в строку «Зарплатный фонд» (команда + ДДС зарплата);
    при курсе 0 для месяца USD остаётся отдельной колонкой.
    Итог: операционный результат без строк, привязанных к «Чистой прибыли»; сама «Чистая прибыль» —
    это дивиденды из ДДС и ручные расходы с таким флагом.
    """
    y = year if year is not None else date.today().year
    columns = [f"{y}-{str(m).zfill(2)}" for m in range(1, 13)]
    n = 12

    slug = get_request_company()
    manual_lines_all = (
        db.query(PlManualLine)
        .filter(PlManualLine.company_slug == slug)
        .order_by(PlManualLine.sort_order.asc(), PlManualLine.id.asc())
        .all()
    )
    manual_ids = [m.id for m in manual_lines_all]
    cells_map: Dict[int, Dict[int, Tuple[Decimal, Decimal]]] = {}
    if manual_ids:
        for c in (
            db.query(PlManualMonthCell)
            .filter(PlManualMonthCell.line_id.in_(manual_ids))
            .filter(PlManualMonthCell.period_month >= f"{y}-01")
            .filter(PlManualMonthCell.period_month <= f"{y}-12")
            .all()
        ):
            try:
                ys, ms = c.period_month.split("-")
                if int(ys) != y:
                    continue
                mi = int(ms)
                if not (1 <= mi <= 12):
                    continue
                idx = mi - 1
            except (ValueError, AttributeError):
                continue
            if c.line_id not in cells_map:
                cells_map[c.line_id] = {}
            cells_map[c.line_id][idx] = (
                Decimal(str(c.amount_uzs or 0)),
                Decimal(str(c.amount_usd or 0)),
            )

    manual_rev_sum_uzs = [Decimal(0) for _ in range(n)]
    manual_rev_sum_usd = [Decimal(0) for _ in range(n)]
    for mline in manual_lines_all:
        if mline.section != "revenue":
            continue
        for i in range(n):
            u, d = cells_map.get(mline.id, {}).get(i, (Decimal(0), Decimal(0)))
            manual_rev_sum_uzs[i] += u
            manual_rev_sum_usd[i] += d

    def _manual_row_cells(line_id: int) -> List[PLCellOut]:
        out: List[PLCellOut] = []
        for i in range(n):
            u, d = cells_map.get(line_id, {}).get(i, (Decimal(0), Decimal(0)))
            out.append(PLCellOut(uzs=u.quantize(Decimal("0.01")), usd=d.quantize(Decimal("0.01"))))
        return out

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
    cf_in_fx_usd = [Decimal("0") for _ in range(n)]
    cf_sal_uzs = [Decimal("0") for _ in range(n)]
    cf_sal_usd = [Decimal("0") for _ in range(n)]
    cf_sal_fx_usd = [Decimal("0") for _ in range(n)]
    cf_off_uzs = [Decimal("0") for _ in range(n)]
    cf_off_usd = [Decimal("0") for _ in range(n)]
    cf_off_fx_usd = [Decimal("0") for _ in range(n)]
    cf_acc_uzs = [Decimal("0") for _ in range(n)]
    cf_acc_usd = [Decimal("0") for _ in range(n)]
    cf_acc_fx_usd = [Decimal("0") for _ in range(n)]
    cf_pub_uzs = [Decimal("0") for _ in range(n)]
    cf_pub_usd = [Decimal("0") for _ in range(n)]
    cf_pub_fx_usd = [Decimal("0") for _ in range(n)]
    cf_tax_uzs = [Decimal("0") for _ in range(n)]
    cf_tax_usd = [Decimal("0") for _ in range(n)]
    cf_tax_fx_usd = [Decimal("0") for _ in range(n)]
    cf_pb_uzs = [Decimal("0") for _ in range(n)]
    cf_pb_usd = [Decimal("0") for _ in range(n)]
    cf_pb_fx_usd = [Decimal("0") for _ in range(n)]
    cf_mkt_uzs = [Decimal("0") for _ in range(n)]
    cf_mkt_usd = [Decimal("0") for _ in range(n)]
    cf_mkt_fx_usd = [Decimal("0") for _ in range(n)]
    cf_sub_uzs = [Decimal("0") for _ in range(n)]
    cf_sub_usd = [Decimal("0") for _ in range(n)]
    cf_sub_fx_usd = [Decimal("0") for _ in range(n)]
    cf_dev_uzs = [Decimal("0") for _ in range(n)]
    cf_dev_usd = [Decimal("0") for _ in range(n)]
    cf_dev_fx_usd = [Decimal("0") for _ in range(n)]
    cf_oth_uzs = [Decimal("0") for _ in range(n)]
    cf_oth_usd = [Decimal("0") for _ in range(n)]
    cf_oth_fx_usd = [Decimal("0") for _ in range(n)]
    cf_agasi_uzs = [Decimal("0") for _ in range(n)]
    cf_agasi_usd = [Decimal("0") for _ in range(n)]
    cf_agasi_fx_usd = [Decimal("0") for _ in range(n)]

    for e in (
        db.query(CashFlowEntry)
        .filter(CashFlowEntry.period_month >= f"{y}-01")
        .filter(CashFlowEntry.period_month <= f"{y}-12")
        .filter(CashFlowEntry.company_slug == get_request_company())
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
        apply_fx = bool(getattr(e, "apply_fx_to_uzs", False))
        if e.direction == "income":
            cf_in_uzs[idx] += au
            cf_in_usd[idx] += ad
            if apply_fx:
                cf_in_fx_usd[idx] += ad
            continue
        b = expense_pl_bucket(e.flow_category)
        if b == "salary":
            cf_sal_uzs[idx] += au
            cf_sal_usd[idx] += ad
            if apply_fx:
                cf_sal_fx_usd[idx] += ad
        elif b == "office":
            cf_off_uzs[idx] += au
            cf_off_usd[idx] += ad
            if apply_fx:
                cf_off_fx_usd[idx] += ad
        elif b == "accounting":
            cf_acc_uzs[idx] += au
            cf_acc_usd[idx] += ad
            if apply_fx:
                cf_acc_fx_usd[idx] += ad
        elif b == "publics":
            cf_pub_uzs[idx] += au
            cf_pub_usd[idx] += ad
            if apply_fx:
                cf_pub_fx_usd[idx] += ad
        elif b == "taxes":
            cf_tax_uzs[idx] += au
            cf_tax_usd[idx] += ad
            if apply_fx:
                cf_tax_fx_usd[idx] += ad
        elif b == "personal_brand":
            cf_pb_uzs[idx] += au
            cf_pb_usd[idx] += ad
            if apply_fx:
                cf_pb_fx_usd[idx] += ad
        elif b == "marketing":
            cf_mkt_uzs[idx] += au
            cf_mkt_usd[idx] += ad
            if apply_fx:
                cf_mkt_fx_usd[idx] += ad
        elif b == "subscriptions":
            cf_sub_uzs[idx] += au
            cf_sub_usd[idx] += ad
            if apply_fx:
                cf_sub_fx_usd[idx] += ad
        elif b == "fund_development":
            cf_dev_uzs[idx] += au
            cf_dev_usd[idx] += ad
            if apply_fx:
                cf_dev_fx_usd[idx] += ad
        elif b == "agasi_d":
            cf_agasi_uzs[idx] += au
            cf_agasi_usd[idx] += ad
            if apply_fx:
                cf_agasi_fx_usd[idx] += ad
        else:
            cf_oth_uzs[idx] += au
            cf_oth_usd[idx] += ad
            if apply_fx:
                cf_oth_fx_usd[idx] += ad

    # --- Зарплатный фонд: все выплаты сотрудникам (роль employee), в т.ч. в USD — дальше × курс ДДС за месяц колонки ---
    salary_uzs = [Decimal("0") for _ in range(n)]
    salary_usd = [Decimal("0") for _ in range(n)]
    payroll = (
        db.query(EmployeePaymentRecord)
        .join(User, User.id == EmployeePaymentRecord.user_id)
        .filter(
            User.role == "employee",
            User.is_active == True,
            User.company_slug == get_request_company(),
            EmployeePaymentRecord.company_slug == get_request_company(),
        )
        .filter(
            or_(
                and_(EmployeePaymentRecord.period_year == y, EmployeePaymentRecord.period_month.isnot(None)),
                and_(
                    EmployeePaymentRecord.paid_on >= date(y, 1, 1),
                    EmployeePaymentRecord.paid_on <= date(y, 12, 31),
                ),
            )
        )
        .all()
    )
    for r in payroll:
        m_idx = _employee_payment_pl_month_index(r, y)
        if m_idx is None:
            continue
        amt = Decimal(str(r.amount))
        bud = Decimal(str(getattr(r, "budget_amount", 0) or 0))
        pl_amt = amt - bud
        if pl_amt < 0:
            pl_amt = Decimal(0)
        cur = (r.currency or "UZS").upper()
        if cur == "USD":
            salary_usd[m_idx - 1] += pl_amt
        else:
            salary_uzs[m_idx - 1] += pl_amt

    # --- Процент менеджера (раздел «Комиссия»): доход менеджера = прибыль × %, по месяцу даты проекта
    # Процент менеджера в P&L — по факту выплаченных/полученных сумм из карточки «Комиссия»;
    # месяц колонки: дата получения (received_amount_*_on) или, если пусто, дата проекта.
    mgr_comm_uzs = [Decimal("0") for _ in range(n)]
    for c in (
        db.query(Commission)
        .filter(Commission.company_slug == get_request_company())
        .all()
    ):
        r1 = Decimal(str(c.received_amount_1 or 0))
        r2 = Decimal(str(c.received_amount_2 or 0))
        if r1 > 0:
            d1 = getattr(c, "received_amount_1_on", None) or c.project_date
            if d1.year == y and 1 <= int(d1.month) <= 12:
                mgr_comm_uzs[int(d1.month) - 1] += r1
        if r2 > 0:
            d2 = getattr(c, "received_amount_2_on", None) or c.project_date
            if d2.year == y and 1 <= int(d2.month) <= 12:
                mgr_comm_uzs[int(d2.month) - 1] += r2

    rates = {
        r.period_month: Decimal(str(r.usd_to_uzs_rate or 0))
        for r in db.query(AvailableFundsManual)
        .filter(
            AvailableFundsManual.period_month >= f"{y}-01",
            AvailableFundsManual.period_month <= f"{y}-12",
            AvailableFundsManual.company_slug == get_request_company(),
        )
        .all()
    }
    _uzs_fx = [
        cf_in_uzs,
        cf_sal_uzs,
        cf_off_uzs,
        cf_acc_uzs,
        cf_pub_uzs,
        cf_tax_uzs,
        cf_pb_uzs,
        cf_mkt_uzs,
        cf_sub_uzs,
        cf_dev_uzs,
        cf_oth_uzs,
        cf_agasi_uzs,
        salary_uzs,
    ]
    _usd_fx = [
        cf_in_fx_usd,
        cf_sal_fx_usd,
        cf_off_fx_usd,
        cf_acc_fx_usd,
        cf_pub_fx_usd,
        cf_tax_fx_usd,
        cf_pb_fx_usd,
        cf_mkt_fx_usd,
        cf_sub_fx_usd,
        cf_dev_fx_usd,
        cf_oth_fx_usd,
        cf_agasi_fx_usd,
        salary_usd,
    ]
    _usd_display = [
        cf_in_usd,
        cf_sal_usd,
        cf_off_usd,
        cf_acc_usd,
        cf_pub_usd,
        cf_tax_usd,
        cf_pb_usd,
        cf_mkt_usd,
        cf_sub_usd,
        cf_dev_usd,
        cf_oth_usd,
        cf_agasi_usd,
        salary_usd,
    ]
    for i, ym_col in enumerate(columns):
        rfx = rates.get(ym_col) or Decimal(0)
        if rfx <= 0:
            continue
        for zu, us_fx, us_disp in zip(_uzs_fx, _usd_fx, _usd_display):
            zu[i] = zu[i] + us_fx[i] * rfx
            us_disp[i] = us_disp[i] - us_fx[i]

    # После конвертации USD→UZS по курсу месяца (ДДС): итог выручки с учётом прихода ДДС и ручных строк «Выручка»
    grand_rev_uzs = [total_rev[i] + cf_in_uzs[i] + manual_rev_sum_uzs[i] for i in range(n)]
    grand_rev_usd = [cf_in_usd[i] + manual_rev_sum_usd[i] for i in range(n)]

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

    for mline in manual_lines_all:
        if mline.section != "revenue":
            continue
        rows.append(
            PLDataRowOut(
                row_id=f"manual_{mline.id}",
                label=mline.label,
                section="revenue",
                is_calculated=False,
                is_manual=True,
                manual_line_id=mline.id,
                cells=_manual_row_cells(mline.id),
            )
        )

    rows.append(
        PLDataRowOut(
            row_id="rev_grand_total",
            label="Итого выручка (проекты + ДДС + ручное)",
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
            row_id="exp_manager_commission",
            label="Процент менеджера (комиссии)",
            section="expenses_fixed",
            is_calculated=False,
            cells=[
                PLCellOut(uzs=mgr_comm_uzs[i].quantize(Decimal("0.01")), usd=Decimal("0"))
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
            row_id="exp_cf_subscriptions",
            label="Подписки (ДДС)",
            section="expenses_fixed",
            is_calculated=False,
            cells=[
                PLCellOut(
                    uzs=cf_sub_uzs[i].quantize(Decimal("0.01")),
                    usd=cf_sub_usd[i].quantize(Decimal("0.01")),
                )
                for i in range(n)
            ],
        )
    )

    rows.append(
        PLDataRowOut(
            row_id="exp_cf_fund_development",
            label="Бюджет на развитие (ДДС)",
            section="expenses_fixed",
            is_calculated=False,
            cells=[
                PLCellOut(
                    uzs=cf_dev_uzs[i].quantize(Decimal("0.01")),
                    usd=cf_dev_usd[i].quantize(Decimal("0.01")),
                )
                for i in range(n)
            ],
        )
    )

    rows.append(
        PLDataRowOut(
            row_id="exp_cf_agasi_d",
            label="Дивиденды учредителей (ДДС)",
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

    # Ручные строки «Постоянные расходы» — суммируются в итог расходов и в операционный результат
    manual_exp_sum_uzs = [Decimal(0) for _ in range(n)]
    manual_exp_sum_usd = [Decimal(0) for _ in range(n)]
    manual_net_profit_sum_uzs = [Decimal(0) for _ in range(n)]
    manual_net_profit_sum_usd = [Decimal(0) for _ in range(n)]
    manual_summary_rows: List[PlManualLine] = []
    for mline in manual_lines_all:
        if mline.section == "expenses_fixed":
            linked_to_net_profit = bool(getattr(mline, "link_to_net_profit", False))
            for i in range(n):
                u, d = cells_map.get(mline.id, {}).get(i, (Decimal(0), Decimal(0)))
                manual_exp_sum_uzs[i] += u
                manual_exp_sum_usd[i] += d
                if linked_to_net_profit:
                    manual_net_profit_sum_uzs[i] += u
                    manual_net_profit_sum_usd[i] += d
            rows.append(
                PLDataRowOut(
                    row_id=f"manual_{mline.id}",
                    label=mline.label,
                    section="expenses_fixed",
                    is_calculated=False,
                    is_manual=True,
                    manual_line_id=mline.id,
                    link_to_net_profit=linked_to_net_profit,
                    cells=_manual_row_cells(mline.id),
                )
            )
        elif mline.section == "summary":
            manual_summary_rows.append(mline)

    exp_total_uzs = [
        merged_sal_uzs[i]
        + mgr_comm_uzs[i]
        + cf_off_uzs[i]
        + cf_acc_uzs[i]
        + cf_pub_uzs[i]
        + cf_tax_uzs[i]
        + cf_pb_uzs[i]
        + cf_mkt_uzs[i]
        + cf_sub_uzs[i]
        + cf_dev_uzs[i]
        + cf_agasi_uzs[i]
        + cf_oth_uzs[i]
        + manual_exp_sum_uzs[i]
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
        + cf_sub_usd[i]
        + cf_dev_usd[i]
        + cf_agasi_usd[i]
        + cf_oth_usd[i]
        + manual_exp_sum_usd[i]
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

    exp_operating_uzs = [exp_total_uzs[i] - cf_agasi_uzs[i] - manual_net_profit_sum_uzs[i] for i in range(n)]
    exp_operating_usd = [exp_total_usd[i] - cf_agasi_usd[i] - manual_net_profit_sum_usd[i] for i in range(n)]
    operating_uzs = [grand_rev_uzs[i] - exp_operating_uzs[i] for i in range(n)]
    operating_usd = [grand_rev_usd[i] - exp_operating_usd[i] for i in range(n)]

    rows.append(
        PLDataRowOut(
            row_id="operating_profit",
            label="Операционный результат (выручка − расходы без чистой прибыли)",
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
            row_id="total_profit",
            label="Общая прибыль",
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

    profitability_pct: List[Decimal] = []
    for i in range(n):
        rev_uzs = grand_rev_uzs[i]
        rev_usd = grand_rev_usd[i]
        profit_uzs = operating_uzs[i]
        profit_usd = operating_usd[i]
        pct = Decimal("0")
        if rev_uzs != 0:
            pct = (profit_uzs / rev_uzs * Decimal("100")).quantize(Decimal("0.01"))
        elif rev_usd != 0:
            pct = (profit_usd / rev_usd * Decimal("100")).quantize(Decimal("0.01"))
        profitability_pct.append(pct)

    rows.append(
        PLDataRowOut(
            row_id="profitability_percent",
            label="Рентабельность",
            section="summary",
            is_calculated=True,
            cells=[
                PLCellOut(
                    uzs=profitability_pct[i],
                    usd=Decimal("0"),
                )
                for i in range(n)
            ],
        )
    )

    rows.append(
        PLDataRowOut(
            row_id="net_profit",
            label="Чистая прибыль",
            section="summary",
            is_calculated=True,
            cells=[
                PLCellOut(
                    uzs=(cf_agasi_uzs[i] + manual_net_profit_sum_uzs[i]).quantize(Decimal("0.01")),
                    usd=(cf_agasi_usd[i] + manual_net_profit_sum_usd[i]).quantize(Decimal("0.01")),
                )
                for i in range(n)
            ],
        )
    )

    for mline in manual_summary_rows:
        rows.append(
            PLDataRowOut(
                row_id=f"manual_{mline.id}",
                label=mline.label,
                section="summary",
                is_calculated=False,
                is_manual=True,
                manual_line_id=mline.id,
                cells=_manual_row_cells(mline.id),
            )
        )

    return PLReportOut(year=y, columns=columns, rows=rows)


@router.get("/pl/manual-lines", response_model=List[PLManualLineOut])
@router.get("/pl-manual-lines", response_model=List[PLManualLineOut])
@router_finance_no_api_prefix.get("/pl-manual-lines", response_model=List[PLManualLineOut])
def list_pl_manual_lines(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_or_financier),
):
    slug = get_request_company()
    rows = (
        db.query(PlManualLine)
        .filter(PlManualLine.company_slug == slug)
        .order_by(PlManualLine.sort_order.asc(), PlManualLine.id.asc())
        .all()
    )
    return [
        PLManualLineOut(
            id=r.id,
            section=r.section,
            label=r.label,
            sort_order=r.sort_order,
            link_to_net_profit=bool(getattr(r, "link_to_net_profit", False)),
        )
        for r in rows
    ]


@router.post("/pl/manual-lines", response_model=PLManualLineOut)
@router.post("/pl-manual-lines", response_model=PLManualLineOut)
@router_finance_no_api_prefix.post("/pl-manual-lines", response_model=PLManualLineOut)
def create_pl_manual_line(
    body: PLManualLineCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_or_financier),
):
    slug = get_request_company()
    r = PlManualLine(
        company_slug=slug,
        section=body.section,
        label=body.label.strip(),
        sort_order=int(body.sort_order),
        link_to_net_profit=bool(body.link_to_net_profit) if body.section == "expenses_fixed" else False,
    )
    try:
        db.add(r)
        db.commit()
        db.refresh(r)
    except (OperationalError, ProgrammingError) as e:
        db.rollback()
        raw = str(getattr(e, "orig", None) or e).lower()
        if "pl_manual" in raw or "no such table" in raw or "does not exist" in raw or "undefinedtable" in raw:
            raise HTTPException(
                status_code=503,
                detail="Таблица ручных строк P&L не найдена в базе. Перезапустите backend после обновления (таблицы создаются при старте приложения).",
            ) from e
        raise HTTPException(status_code=500, detail="Ошибка сохранения в базу") from e
    return PLManualLineOut(
        id=r.id,
        section=r.section,
        label=r.label,
        sort_order=r.sort_order,
        link_to_net_profit=bool(getattr(r, "link_to_net_profit", False)),
    )


@router.put("/pl/manual-lines/{line_id}", response_model=PLManualLineOut)
@router.put("/pl-manual-lines/{line_id}", response_model=PLManualLineOut)
@router_finance_no_api_prefix.put("/pl-manual-lines/{line_id}", response_model=PLManualLineOut)
def update_pl_manual_line(
    line_id: int,
    body: PLManualLineUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_or_financier),
):
    slug = get_request_company()
    r = (
        db.query(PlManualLine)
        .filter(PlManualLine.id == line_id, PlManualLine.company_slug == slug)
        .first()
    )
    if r is None:
        raise HTTPException(status_code=404, detail="Строка не найдена")
    if body.label is not None:
        r.label = body.label.strip()
    if body.section is not None:
        r.section = body.section
    if body.sort_order is not None:
        r.sort_order = int(body.sort_order)
    if body.link_to_net_profit is not None:
        r.link_to_net_profit = bool(body.link_to_net_profit) if (body.section or r.section) == "expenses_fixed" else False
    elif (body.section or r.section) != "expenses_fixed":
        r.link_to_net_profit = False
    db.commit()
    db.refresh(r)
    return PLManualLineOut(
        id=r.id,
        section=r.section,
        label=r.label,
        sort_order=r.sort_order,
        link_to_net_profit=bool(getattr(r, "link_to_net_profit", False)),
    )


@router.delete("/pl/manual-lines/{line_id}", response_model=dict)
@router.delete("/pl-manual-lines/{line_id}", response_model=dict)
@router_finance_no_api_prefix.delete("/pl-manual-lines/{line_id}", response_model=dict)
def delete_pl_manual_line(
    line_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_or_financier),
):
    slug = get_request_company()
    r = (
        db.query(PlManualLine)
        .filter(PlManualLine.id == line_id, PlManualLine.company_slug == slug)
        .first()
    )
    if r is None:
        raise HTTPException(status_code=404, detail="Строка не найдена")
    db.delete(r)
    db.commit()
    return {"ok": True}


@router.put("/pl/manual-lines/{line_id}/cell", response_model=dict)
@router.put("/pl-manual-lines/{line_id}/cell", response_model=dict)
@router_finance_no_api_prefix.put("/pl-manual-lines/{line_id}/cell", response_model=dict)
def put_pl_manual_cell(
    line_id: int,
    body: PLManualCellPut,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_or_financier),
):
    if not _YM_RE.match(body.period_month):
        raise HTTPException(status_code=400, detail="Неверный формат месяца (YYYY-MM)")
    slug = get_request_company()
    r = (
        db.query(PlManualLine)
        .filter(PlManualLine.id == line_id, PlManualLine.company_slug == slug)
        .first()
    )
    if r is None:
        raise HTTPException(status_code=404, detail="Строка не найдена")
    u = Decimal(str(body.uzs or 0)).quantize(Decimal("0.01"))
    d = Decimal(str(body.usd or 0)).quantize(Decimal("0.01"))
    ex = (
        db.query(PlManualMonthCell)
        .filter(PlManualMonthCell.line_id == line_id, PlManualMonthCell.period_month == body.period_month)
        .first()
    )
    if ex:
        ex.amount_uzs = u
        ex.amount_usd = d
    else:
        db.add(
            PlManualMonthCell(
                line_id=line_id,
                period_month=body.period_month,
                amount_uzs=u,
                amount_usd=d,
            )
        )
    db.commit()
    return {"ok": True}
