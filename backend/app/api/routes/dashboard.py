from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, extract
from datetime import date, datetime
from typing import Optional, List, Tuple
from decimal import Decimal
from calendar import monthrange
from app.db.database import get_db
from app.models.payment import Payment
from app.models.partner import Partner
from app.schemas.schemas import (
    DashboardStats,
    CeoStats,
    CeoTurnoverOut,
    CeoTurnoverPoint,
    CeoLtvOut,
    CeoLtvBucket,
    CeoClientHistoryOut,
    CeoClientHistoryPoint,
)
from app.core.security import get_current_user
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


@router.get("", response_model=DashboardStats)
def get_dashboard(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    today = date.today()
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

    # Base filter for active (non-archived) payments in the period
    def period_filter(q, use_created_at=True):
        q = q.filter(Payment.is_archived == False)
        q = filter_payments_query(q, db, current_user)
        if date_from and use_created_at:
            q = q.filter(func.date(Payment.created_at) >= date_from)
        if date_to and use_created_at:
            q = q.filter(func.date(Payment.created_at) <= date_to)
        return q

    def paid_period_filter(q):
        q = q.filter(Payment.is_archived == False)
        q = filter_payments_query(q, db, current_user)
        if date_from:
            q = q.filter(func.date(Payment.paid_at) >= date_from)
        if date_to:
            q = q.filter(func.date(Payment.paid_at) <= date_to)
        else:
            # Default: current month
            q = q.filter(
                func.extract("month", Payment.paid_at) == today.month,
                func.extract("year", Payment.paid_at) == today.year
            )
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

    paid_q = db.query(func.count(Payment.id)).filter(Payment.status == "paid")
    paid_q = filter_payments_query(paid_q, db, current_user)
    paid_amount_q = db.query(func.sum(Payment.amount)).filter(Payment.status == "paid")
    paid_amount_q = filter_payments_query(paid_amount_q, db, current_user)

    if date_from or date_to:
        paid_this_month = paid_period_filter(paid_q).scalar() or 0
        paid_amount_this_month = paid_period_filter(paid_amount_q).scalar() or Decimal(0)
    else:
        paid_this_month = paid_q.filter(
            func.extract("month", Payment.paid_at) == today.month,
            func.extract("year", Payment.paid_at) == today.year
        ).scalar() or 0
        paid_amount_this_month = paid_amount_q.filter(
            func.extract("month", Payment.paid_at) == today.month,
            func.extract("year", Payment.paid_at) == today.year
        ).scalar() or Decimal(0)

    pcq = db.query(func.count(Partner.id)).filter(
        Partner.status == "active",
        Partner.is_deleted == False,
    )
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
    current_user: User = Depends(get_current_user),
):
    """Все неархивные проекты (платежи) по линиям Web / SEO / PPC для CEO Dashboard."""
    ids = accessible_partner_ids(db, current_user)
    if ids is not None and len(ids) == 0:
        return CeoStats(total_projects=0, web_projects=0, seo_projects=0, ppc_projects=0)

    def base_q():
        q = db.query(Payment).filter(Payment.is_archived == False)
        return filter_payments_query(q, db, current_user)

    total_projects = base_q().count()
    web_projects = base_q().filter(Payment.project_category == "web").count()
    seo_projects = base_q().filter(Payment.project_category == "seo").count()
    ppc_projects = base_q().filter(Payment.project_category == "ppc").count()
    return CeoStats(
        total_projects=total_projects,
        web_projects=web_projects,
        seo_projects=seo_projects,
        ppc_projects=ppc_projects,
    )


@router.get("/ceo/turnover", response_model=CeoTurnoverOut)
def get_ceo_turnover(
    months: int = 12,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Оборот по месяцам: сумма оплаченных проектов (status=paid) по дате paid_at.
    Пунктир — тот же месяц год назад (для сравнения).
    """
    n = max(1, min(int(months), 36))
    ids = accessible_partner_ids(db, current_user)
    if ids is not None and len(ids) == 0:
        return CeoTurnoverOut(points=[])

    roll = _rolling_months(n)
    y0, m0 = roll[0]
    y1, m1 = roll[-1]
    start_date = date(y0 - 1, m0, 1)
    end_date = date(y1, m1, monthrange(y1, m1)[1])

    q = (
        db.query(
            extract("year", Payment.paid_at).label("yy"),
            extract("month", Payment.paid_at).label("mm"),
            func.coalesce(func.sum(Payment.amount), 0).label("total"),
        )
        .filter(
            Payment.is_archived == False,
            Payment.status == "paid",
            Payment.paid_at.isnot(None),
            func.date(Payment.paid_at) >= start_date,
            func.date(Payment.paid_at) <= end_date,
        )
    )
    q = filter_payments_query(q, db, current_user)
    q = q.group_by(extract("year", Payment.paid_at), extract("month", Payment.paid_at))
    rows = q.all()
    agg: dict[Tuple[int, int], Decimal] = {}
    for r in rows:
        yy, mm = int(r.yy), int(r.mm)
        agg[(yy, mm)] = Decimal(str(r.total)) if r.total is not None else Decimal(0)

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
    return CeoTurnoverOut(points=points)


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


@router.get("/ceo/partner-ltv", response_model=CeoLtvOut)
def get_partner_ltv(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Распределение активных компаний по «возрасту» с даты добавления (LTV по времени сотрудничества).
    Учитываются только партнёры со статусом active и не удалённые.
    """
    ids = accessible_partner_ids(db, current_user)
    if ids is not None and len(ids) == 0:
        return CeoLtvOut(
            buckets=[CeoLtvBucket(key=k, label=lab, count=0) for k, lab in _LTV_BUCKET_SPEC]
        )

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

    buckets = [CeoLtvBucket(key=k, label=lab, count=n) for (k, lab), n in zip(_LTV_BUCKET_SPEC, c)]
    return CeoLtvOut(buckets=buckets)


@router.get("/ceo/client-history", response_model=CeoClientHistoryOut)
def get_client_history(
    year: Optional[int] = Query(None, description="Календарный год (по умолчанию текущий)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
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
    return CeoClientHistoryOut(year=y, points=points)
