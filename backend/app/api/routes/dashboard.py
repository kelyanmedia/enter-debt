from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, extract, select
from datetime import date, datetime
from typing import Optional, List, Tuple, Dict, Any
from decimal import Decimal
from calendar import monthrange
from app.db.database import get_db
from app.models.payment import Payment, PaymentMonth
from app.models.partner import Partner
from app.models.ceo_metric_override import CeoMetricOverride
from app.schemas.schemas import (
    DashboardStats,
    CeoStats,
    CeoTurnoverOut,
    CeoTurnoverPoint,
    CeoLtvOut,
    CeoLtvBucket,
    CeoClientHistoryOut,
    CeoClientHistoryPoint,
    CeoOverridePut,
)
from app.core.security import get_current_user, require_admin, require_admin_or_accountant
from app.core.access import accessible_partner_ids, filter_payments_query, filter_partners_query
from app.models.user import User

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

_MONTHS_RU = (
    "янв.",
    "фев.",
    "мар.",
    "апр.",
    "мая",
    "июн.",
    "июл.",
    "авг.",
    "сен.",
    "окт.",
    "нояб.",
    "дек.",
)

_LTV_BUCKET_SPEC = (
    ("lt_3", "Меньше 3 мес."),
    ("m3_6", "От 3 до 6 мес."),
    ("m6_9", "От 6 до 9 мес."),
    ("m9_12", "От 9 до 12 мес."),
    ("m12_18", "От 12 до 18 мес."),
    ("gte_18", "Больше 18 мес."),
)


def _rolling_months(n: int) -> List[Tuple[int, int]]:
    """Последние n календарных месяцев, включая текущий (слева направо по времени)."""
    today = date.today()
    y, m = today.year, today.month
    months: List[Tuple[int, int]] = []
    for _ in range(n):
        months.append((y, m))
        if m == 1:
            m = 12
            y -= 1
        else:
            m -= 1
    months.reverse()
    return months


def _get_override_dict(db: Session, metric: str, year: int) -> Dict[str, Any]:
    row = (
        db.query(CeoMetricOverride)
        .filter(CeoMetricOverride.metric == metric, CeoMetricOverride.year == year)
        .first()
    )
    if not row or not row.data:
        return {}
    return dict(row.data)


def _build_paid_agg(
    db: Session,
    current_user: User,
    start_date: date,
    end_date: date,
) -> Dict[Tuple[int, int], Decimal]:
    """
    Агрегирует фактические оплаты по (год, месяц) из двух источников:
    1. PaymentMonth.paid_at — помесячные оплаты (кнопка «Оплата прошла» в ящике).
    2. Payment.paid_at — разовые проекты без месяцев, подтверждённые кнопкой «✅ Оплачено».
    Двойного счёта нет: источник 2 исключает проекты, у которых есть хотя бы один PaymentMonth.
    """
    agg: Dict[Tuple[int, int], Decimal] = {}

    # --- Источник 1: подтверждённые месяцы ---
    q1 = (
        db.query(
            extract("year", PaymentMonth.paid_at).label("yy"),
            extract("month", PaymentMonth.paid_at).label("mm"),
            func.coalesce(
                func.sum(func.coalesce(PaymentMonth.amount, Payment.amount)), 0
            ).label("total"),
        )
        .join(Payment, Payment.id == PaymentMonth.payment_id)
        .filter(
            Payment.is_archived == False,
            PaymentMonth.status == "paid",
            PaymentMonth.paid_at.isnot(None),
            func.date(PaymentMonth.paid_at) >= start_date,
            func.date(PaymentMonth.paid_at) <= end_date,
        )
    )
    q1 = filter_payments_query(q1, db, current_user)
    q1 = q1.group_by(
        extract("year", PaymentMonth.paid_at),
        extract("month", PaymentMonth.paid_at),
    )
    for r in q1.all():
        k = (int(r.yy), int(r.mm))
        agg[k] = agg.get(k, Decimal(0)) + (Decimal(str(r.total)) if r.total else Decimal(0))

    # --- Источник 2: проекты без месяцев, подтверждённые напрямую ---
    has_months_sq = select(PaymentMonth.payment_id).distinct()
    q2 = (
        db.query(
            extract("year", Payment.paid_at).label("yy"),
            extract("month", Payment.paid_at).label("mm"),
            func.coalesce(func.sum(Payment.amount), 0).label("total"),
        )
        .filter(
            Payment.is_archived == False,
            Payment.status == "paid",
            Payment.paid_at.isnot(None),
            ~Payment.id.in_(has_months_sq),
            func.date(Payment.paid_at) >= start_date,
            func.date(Payment.paid_at) <= end_date,
        )
    )
    q2 = filter_payments_query(q2, db, current_user)
    q2 = q2.group_by(
        extract("year", Payment.paid_at),
        extract("month", Payment.paid_at),
    )
    for r in q2.all():
        k = (int(r.yy), int(r.mm))
        agg[k] = agg.get(k, Decimal(0)) + (Decimal(str(r.total)) if r.total else Decimal(0))

    return agg


def _turnover_points_for_roll(
    db: Session,
    current_user: User,
    roll: List[Tuple[int, int]],
) -> List[CeoTurnoverPoint]:
    if not roll:
        return []
    y0, m0 = roll[0]
    y1, m1 = roll[-1]
    # Нужен год назад для «прошлого года» на графике
    start_date = date(y0 - 1, m0, 1)
    end_date = date(y1, m1, monthrange(y1, m1)[1])

    agg = _build_paid_agg(db, current_user, start_date, end_date)

    points: List[CeoTurnoverPoint] = []
    for y, m in roll:
        amt = agg.get((y, m), Decimal(0))
        prev = agg.get((y - 1, m), Decimal(0))
        points.append(
            CeoTurnoverPoint(
                month=f"{y}-{m:02d}",
                label=f"{_MONTHS_RU[m - 1]} {y}",
                amount=amt,
                previous_year_amount=prev,
            )
        )
    return points


def _debitor_filter_by_manager(manager_id: Optional[int], current_user: User) -> bool:
    """Админ/бухгалтерия могут сузить дебиторку до одного менеджера."""
    return manager_id is not None and current_user.role in ("admin", "accountant")


@router.get("", response_model=DashboardStats)
def get_dashboard(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    manager_id: Optional[int] = Query(
        None,
        description="Только партнёры и проекты выбранного менеджера (только для админа и бухгалтерии)",
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Сводка для главной и страницы «Дебиторка».
    Менеджер видит только свои данные (как в списке проектов); админ/бухгалтерия — все,
    с опциональным manager_id для согласованности с фильтром в таблице.
    """
    ids = accessible_partner_ids(db, current_user)
    if ids is not None and len(ids) == 0:
        return DashboardStats(
            total_receivable=Decimal(0),
            overdue_count=0,
            pending_count=0,
            paid_this_month=0,
            paid_amount_this_month=Decimal(0),
            partners_count=0,
        )

    mgr_scope = _debitor_filter_by_manager(manager_id, current_user)

    # Base filter for active (non-archived) payments in the period
    def period_filter(q, use_created_at=True):
        q = q.filter(Payment.is_archived == False)
        q = filter_payments_query(q, db, current_user)
        if mgr_scope:
            q = q.join(Partner, Payment.partner_id == Partner.id).filter(Partner.manager_id == manager_id)
        if date_from and use_created_at:
            q = q.filter(func.date(Payment.created_at) >= date_from)
        if date_to and use_created_at:
            q = q.filter(func.date(Payment.created_at) <= date_to)
        return q

    total_receivable = period_filter(
        db.query(func.sum(Payment.amount)).filter(Payment.status.in_(["pending", "overdue"]))
    ).scalar() or Decimal(0)

    overdue_count = period_filter(
        db.query(func.count(Payment.id)).filter(Payment.status == "overdue")
    ).scalar() or 0

    pending_count = period_filter(
        db.query(func.count(Payment.id)).filter(Payment.status == "pending")
    ).scalar() or 0

    # ── Оплаченные: PaymentMonth + Payment без месяцев ───────────────────────
    # Диапазон дат оплат: при выбранном периоде — он же; при «Всё время» (без дат) —
    # весь срок, иначе цифры в карточках не совпадали с фильтром неоплаченных.
    if date_from or date_to:
        _df = date_from or date(2000, 1, 1)
        _dt = date_to or date(2100, 12, 31)
    else:
        _df = date(2000, 1, 1)
        _dt = date(2100, 12, 31)

    # Источник 1: подтверждённые месяцы
    pm_cnt_q = (
        db.query(func.count(PaymentMonth.id))
        .join(Payment, Payment.id == PaymentMonth.payment_id)
        .filter(
            Payment.is_archived == False,
            PaymentMonth.status == "paid",
            PaymentMonth.paid_at.isnot(None),
            func.date(PaymentMonth.paid_at) >= _df,
            func.date(PaymentMonth.paid_at) <= _dt,
        )
    )
    pm_cnt_q = filter_payments_query(pm_cnt_q, db, current_user)
    if mgr_scope:
        pm_cnt_q = pm_cnt_q.join(Partner, Payment.partner_id == Partner.id).filter(Partner.manager_id == manager_id)

    pm_sum_q = (
        db.query(func.coalesce(func.sum(func.coalesce(PaymentMonth.amount, Payment.amount)), 0))
        .join(Payment, Payment.id == PaymentMonth.payment_id)
        .filter(
            Payment.is_archived == False,
            PaymentMonth.status == "paid",
            PaymentMonth.paid_at.isnot(None),
            func.date(PaymentMonth.paid_at) >= _df,
            func.date(PaymentMonth.paid_at) <= _dt,
        )
    )
    pm_sum_q = filter_payments_query(pm_sum_q, db, current_user)
    if mgr_scope:
        pm_sum_q = pm_sum_q.join(Partner, Payment.partner_id == Partner.id).filter(Partner.manager_id == manager_id)

    # Источник 2: разовые проекты без месяцев, подтверждённые напрямую
    has_months_sq = select(PaymentMonth.payment_id).distinct()
    p_cnt_q = (
        db.query(func.count(Payment.id))
        .filter(
            Payment.is_archived == False,
            Payment.status == "paid",
            Payment.paid_at.isnot(None),
            ~Payment.id.in_(has_months_sq),
            func.date(Payment.paid_at) >= _df,
            func.date(Payment.paid_at) <= _dt,
        )
    )
    p_cnt_q = filter_payments_query(p_cnt_q, db, current_user)
    if mgr_scope:
        p_cnt_q = p_cnt_q.join(Partner, Payment.partner_id == Partner.id).filter(Partner.manager_id == manager_id)

    p_sum_q = (
        db.query(func.coalesce(func.sum(Payment.amount), 0))
        .filter(
            Payment.is_archived == False,
            Payment.status == "paid",
            Payment.paid_at.isnot(None),
            ~Payment.id.in_(has_months_sq),
            func.date(Payment.paid_at) >= _df,
            func.date(Payment.paid_at) <= _dt,
        )
    )
    p_sum_q = filter_payments_query(p_sum_q, db, current_user)
    if mgr_scope:
        p_sum_q = p_sum_q.join(Partner, Payment.partner_id == Partner.id).filter(Partner.manager_id == manager_id)

    paid_this_month = (pm_cnt_q.scalar() or 0) + (p_cnt_q.scalar() or 0)
    paid_amount_this_month = (pm_sum_q.scalar() or Decimal(0)) + (p_sum_q.scalar() or Decimal(0))

    pcq = db.query(func.count(Partner.id)).filter(
        Partner.status == "active",
        Partner.is_deleted == False,
    )
    if mgr_scope:
        pcq = pcq.filter(Partner.manager_id == manager_id)
    pcq = filter_partners_query(pcq, db, current_user)
    partners_count = pcq.scalar() or 0

    return DashboardStats(
        total_receivable=total_receivable,
        overdue_count=overdue_count,
        pending_count=pending_count,
        paid_this_month=paid_this_month,
        paid_amount_this_month=paid_amount_this_month,
        partners_count=partners_count,
    )


@router.get("/ceo", response_model=CeoStats)
def get_ceo_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_or_accountant),
):
    """Все неархивные проекты (платежи) по линиям Web / SEO / PPC для CEO Dashboard."""
    ids = accessible_partner_ids(db, current_user)
    if ids is not None and len(ids) == 0:
        return CeoStats(
            total_projects=0,
            web_projects=0,
            seo_projects=0,
            ppc_projects=0,
            mobile_app_projects=0,
            tech_support_projects=0,
            hosting_domain_projects=0,
        )

    def base_q():
        q = db.query(Payment).filter(Payment.is_archived == False)
        return filter_payments_query(q, db, current_user)

    total_projects = base_q().count()
    web_projects = base_q().filter(Payment.project_category == "web").count()
    seo_projects = base_q().filter(Payment.project_category == "seo").count()
    ppc_projects = base_q().filter(Payment.project_category == "ppc").count()
    mobile_app_projects = base_q().filter(Payment.project_category == "mobile_app").count()
    tech_support_projects = base_q().filter(Payment.project_category == "tech_support").count()
    hosting_domain_projects = base_q().filter(Payment.project_category == "hosting_domain").count()
    return CeoStats(
        total_projects=total_projects,
        web_projects=web_projects,
        seo_projects=seo_projects,
        ppc_projects=ppc_projects,
        mobile_app_projects=mobile_app_projects,
        tech_support_projects=tech_support_projects,
        hosting_domain_projects=hosting_domain_projects,
    )


@router.get("/ceo/turnover", response_model=CeoTurnoverOut)
def get_ceo_turnover(
    year: Optional[int] = Query(None, description="Календарный год (янв–дек). Если не задан — скользящие 12 мес."),
    months: int = 12,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_or_accountant),
):
    """
    Оборот по месяцам: сумма оплаченных проектов (status=paid) по дате paid_at.
    Пунктир — тот же месяц год назад. Ручные правки (админ) подмешиваются для выбранного года.
    """
    ids = accessible_partner_ids(db, current_user)
    if ids is not None and len(ids) == 0:
        return CeoTurnoverOut(year=year, points=[])

    if year is not None:
        y = year if 2000 <= year <= 2100 else date.today().year
        roll = [(y, m) for m in range(1, 13)]
        points = _turnover_points_for_roll(db, current_user, roll)
        ov = _get_override_dict(db, "turnover", y)
        if ov:
            for i in range(len(points)):
                k = str(i + 1)
                if k in ov:
                    m = i + 1
                    points[i] = CeoTurnoverPoint(
                        month=f"{y}-{m:02d}",
                        label=f"{_MONTHS_RU[m - 1]} {y}",
                        amount=Decimal(str(ov[k])),
                        previous_year_amount=points[i].previous_year_amount,
                    )
        return CeoTurnoverOut(year=y, points=points)

    n = max(1, min(int(months), 36))
    roll = _rolling_months(n)
    points = _turnover_points_for_roll(db, current_user, roll)
    return CeoTurnoverOut(year=None, points=points)


def _tenure_months(created_at) -> int:
    """Полных календарных месяцев с даты добавления партнёра до сегодня."""
    if created_at is None:
        return 0
    d = created_at.date() if isinstance(created_at, datetime) else created_at
    today = date.today()
    months = (today.year - d.year) * 12 + (today.month - d.month)
    if today.day < d.day:
        months -= 1
    return max(0, months)


def _ltv_buckets_live(db: Session, current_user: User) -> List[CeoLtvBucket]:
    ids = accessible_partner_ids(db, current_user)
    if ids is not None and len(ids) == 0:
        return [CeoLtvBucket(key=k, label=lab, count=0) for k, lab in _LTV_BUCKET_SPEC]

    q = db.query(Partner).filter(Partner.is_deleted == False, Partner.status == "active")
    q = filter_partners_query(q, db, current_user)
    partners = q.all()

    c = [0, 0, 0, 0, 0, 0]
    for p in partners:
        m = _tenure_months(p.created_at)
        if m < 3:
            c[0] += 1
        elif m < 6:
            c[1] += 1
        elif m < 9:
            c[2] += 1
        elif m < 12:
            c[3] += 1
        elif m < 18:
            c[4] += 1
        else:
            c[5] += 1

    return [CeoLtvBucket(key=k, label=lab, count=n) for (k, lab), n in zip(_LTV_BUCKET_SPEC, c)]


@router.get("/ceo/partner-ltv", response_model=CeoLtvOut)
def get_partner_ltv(
    year: Optional[int] = Query(None, description="Год среза; ручные значения по году или live для текущего"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_or_accountant),
):
    """
    Распределение активных компаний по «возрасту» с даты добавления (LTV по времени сотрудничества).
    Учитываются только партнёры со статусом active и не удалённые.
    Для прошлых лет без ручного среза — нули; для текущего года без ручного среза — расчёт из базы.
    """
    today_y = date.today().year

    if year is not None:
        y = year if 2000 <= year <= 2100 else today_y
        ov = _get_override_dict(db, "ltv", y)
        if ov:
            buckets = []
            for k, lab in _LTV_BUCKET_SPEC:
                buckets.append(CeoLtvBucket(key=k, label=lab, count=int(ov.get(k, 0))))
            return CeoLtvOut(year=y, buckets=buckets)
        if y == today_y:
            return CeoLtvOut(year=y, buckets=_ltv_buckets_live(db, current_user))
        return CeoLtvOut(
            year=y,
            buckets=[CeoLtvBucket(key=k, label=lab, count=0) for k, lab in _LTV_BUCKET_SPEC],
        )

    return CeoLtvOut(year=None, buckets=_ltv_buckets_live(db, current_user))


@router.get("/ceo/client-history", response_model=CeoClientHistoryOut)
def get_client_history(
    year: Optional[int] = Query(None, description="Календарный год (по умолчанию текущий)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_or_accountant),
):
    """
    Число новых компаний (партнёров) по месяцам за год — по дате добавления в систему (created_at).
    История фиксируется фактом записи в БД; учитываются партнёры с is_deleted=False.
    """
    y = year if year is not None else date.today().year
    if y < 2000 or y > 2100:
        y = date.today().year

    ids = accessible_partner_ids(db, current_user)
    if ids is not None and len(ids) == 0:
        return CeoClientHistoryOut(
            year=y,
            points=[
                CeoClientHistoryPoint(month=f"{y}-{m:02d}", label=f"{_MONTHS_RU[m - 1]} {y}", count=0)
                for m in range(1, 13)
            ],
        )

    q = (
        db.query(
            extract("month", Partner.created_at).label("mm"),
            func.count(Partner.id).label("cnt"),
        )
        .filter(
            Partner.is_deleted == False,
            extract("year", Partner.created_at) == y,
        )
    )
    q = filter_partners_query(q, db, current_user)
    q = q.group_by(extract("month", Partner.created_at))
    rows = {int(r.mm): int(r.cnt) for r in q.all()}

    points: List[CeoClientHistoryPoint] = [
        CeoClientHistoryPoint(
            month=f"{y}-{m:02d}",
            label=f"{_MONTHS_RU[m - 1]} {y}",
            count=rows.get(m, 0),
        )
        for m in range(1, 13)
    ]
    ov = _get_override_dict(db, "client_history", y)
    if ov:
        for i in range(12):
            k = str(i + 1)
            if k in ov:
                m = i + 1
                points[i] = CeoClientHistoryPoint(
                    month=f"{y}-{m:02d}",
                    label=f"{_MONTHS_RU[m - 1]} {y}",
                    count=int(ov[k]),
                )
    return CeoClientHistoryOut(year=y, points=points)


def _validate_override_payload(metric: str, data: Dict[str, Any]) -> None:
    if metric == "client_history" or metric == "turnover":
        for k, v in data.items():
            if k not in {str(i) for i in range(1, 13)}:
                raise HTTPException(status_code=400, detail=f"Неверный ключ месяца: {k}")
        if metric == "client_history":
            for k, v in data.items():
                if int(v) < 0:
                    raise HTTPException(status_code=400, detail="Количество не может быть отрицательным")
        else:
            for k, v in data.items():
                if Decimal(str(v)) < 0:
                    raise HTTPException(status_code=400, detail="Сумма не может быть отрицательной")
    elif metric == "ltv":
        allowed = {k for k, _ in _LTV_BUCKET_SPEC}
        for k in data:
            if k not in allowed:
                raise HTTPException(status_code=400, detail=f"Неверная корзина LTV: {k}")
        for k, v in data.items():
            if int(v) < 0:
                raise HTTPException(status_code=400, detail="Количество не может быть отрицательным")
    else:
        raise HTTPException(status_code=400, detail="Неизвестный metric")


@router.put("/ceo/overrides", response_model=dict)
def put_ceo_override(
    body: CeoOverridePut,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    if body.year < 2000 or body.year > 2100:
        raise HTTPException(status_code=400, detail="Неверный год")
    _validate_override_payload(body.metric, body.data)

    row = (
        db.query(CeoMetricOverride)
        .filter(CeoMetricOverride.metric == body.metric, CeoMetricOverride.year == body.year)
        .first()
    )
    if row:
        row.data = body.data
    else:
        db.add(CeoMetricOverride(metric=body.metric, year=body.year, data=body.data))
    db.commit()
    return {"ok": True}


@router.delete("/ceo/overrides/{metric}/{year}", response_model=dict)
def delete_ceo_override(
    metric: str,
    year: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    if metric not in ("client_history", "turnover", "ltv"):
        raise HTTPException(status_code=400, detail="Неизвестный metric")
    row = (
        db.query(CeoMetricOverride)
        .filter(CeoMetricOverride.metric == metric, CeoMetricOverride.year == year)
        .first()
    )
    if row:
        db.delete(row)
        db.commit()
    return {"ok": True}
