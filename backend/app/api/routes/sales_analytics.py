"""CRM: аналитика продаж — агрегация из сделок и клиентской базы."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.core.security import get_current_user
from app.db.database import get_db, get_request_company
from app.models.available_funds_manual import AvailableFundsManual
from app.models.sale_pipeline import SaleDeal, SaleDealComment, SalePipelineStage
from app.models.sales_company import SalesCompany, SalesCompanyGroup, SalesCompanyInteraction
from app.models.user import User

router = APIRouter(prefix="/api/sales", tags=["sales-crm"])


from app.services.client_geo import geo_meta, normalize_client_geo
from app.services.sales_access import get_mop_user_ids, is_sales_rop, require_crm_pipeline


def _require_sales(current_user: User = Depends(get_current_user)) -> User:
    return require_crm_pipeline(current_user)


def _money(v: Optional[Decimal]) -> float:
    if v is None:
        return 0.0
    return float(v)


def _period_key(dt: Optional[datetime]) -> str:
    d = dt or datetime.utcnow()
    return f"{d.year:04d}-{d.month:02d}"


def _currency_rates(db: Session, slug: str) -> Dict[str, Decimal]:
    q = (
        db.query(AvailableFundsManual)
        .filter(AvailableFundsManual.company_slug == slug)
        .order_by(AvailableFundsManual.period_month.asc())
    )
    rows = q.all()
    if not rows:
        rows = (
            db.query(AvailableFundsManual)
            .order_by(AvailableFundsManual.period_month.asc())
            .all()
        )
    return {
        r.period_month: Decimal(str(r.usd_to_uzs_rate or 0))
        for r in rows
        if Decimal(str(r.usd_to_uzs_rate or 0)) > 0
    }


def _rate_for_period(rates: Dict[str, Decimal], period_month: str) -> Decimal:
    if not rates:
        return Decimal("1")
    if period_month in rates:
        return rates[period_month]
    prev = [k for k in rates if k <= period_month]
    if prev:
        return rates[max(prev)]
    return rates[min(rates)]


def _pct_change(current: float, previous: float) -> float:
    if previous <= 0:
        return 100.0 if current > 0 else 0.0
    return round((current - previous) / previous * 100, 1)


def _month_start(dt: datetime) -> datetime:
    return dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    idx = year * 12 + (month - 1) + delta
    return idx // 12, idx % 12 + 1


def _month_label_ru(year: int, month: int) -> str:
    names = [
        "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
        "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
    ]
    return f"{names[month - 1]} {str(year)[-2:]}"


def _month_label_ru_full(year: int, month: int) -> str:
    names = [
        "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
        "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
    ]
    return f"{names[month - 1]} {year}"


def _day_label_ru(d: date) -> str:
    names = [
        "янв", "фев", "мар", "апр", "май", "июн",
        "июл", "авг", "сен", "окт", "ноя", "дек",
    ]
    return f"{d.day} {names[d.month - 1]}"


def _naive_dt(dt: Optional[datetime]) -> Optional[datetime]:
    """Привести datetime к naive UTC для сравнений (SQLite/Postgres)."""
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _build_revenue_performance(
    deals_list: List[SaleDeal],
    anchor: datetime,
    period: str,
    money_fn,
) -> Dict[str, Any]:
    labels: List[str] = []
    revenue_pts: List[float] = []
    expense_pts: List[float] = []
    profit_pts: List[float] = []

    def add_bucket(label: str, start: datetime, end: datetime) -> None:
        bucket_deals = []
        for d in deals_list:
            created = _naive_dt(d.created_at)
            if created is not None and start <= created <= end:
                bucket_deals.append(d)
        rev = sum(money_fn(d) for d in bucket_deals)
        exp = rev * 0.35
        labels.append(label)
        revenue_pts.append(round(rev, 1))
        expense_pts.append(round(exp, 1))
        profit_pts.append(round(rev - exp, 1))

    anchor_date = anchor.date()

    if period == "7d":
        for i in range(6, -1, -1):
            day = anchor_date - timedelta(days=i)
            start = datetime.combine(day, datetime.min.time())
            end = start + timedelta(days=1) - timedelta(microseconds=1)
            add_bucket(_day_label_ru(day), start, end)
    elif period == "30d":
        for i in range(29, -1, -1):
            day = anchor_date - timedelta(days=i)
            start = datetime.combine(day, datetime.min.time())
            end = start + timedelta(days=1) - timedelta(microseconds=1)
            add_bucket(_day_label_ru(day), start, end)
    elif period == "3m":
        for i in range(12, -1, -1):
            week_end_d = anchor_date - timedelta(days=i * 7)
            week_start_d = week_end_d - timedelta(days=6)
            start = datetime.combine(week_start_d, datetime.min.time())
            end = datetime.combine(week_end_d, datetime.max.time()).replace(microsecond=0)
            add_bucket(_day_label_ru(week_end_d), start, end)
    else:
        for i in range(11, -1, -1):
            y, m = _shift_month(anchor.year, anchor.month, -i)
            start = datetime(y, m, 1)
            ny, nm = _shift_month(y, m, 1)
            end = datetime(ny, nm, 1) - timedelta(microseconds=1)
            add_bucket(_month_label_ru(y, m), start, end)

    return {
        "period": period,
        "labels": labels,
        "revenue": revenue_pts,
        "expenses": expense_pts,
        "profit": profit_pts,
    }


SOURCE_COLORS = {
    "Веб-сайт": "#86efac",
    "Рекомендация": "#93c5fd",
    "Холодный звонок": "#fdba74",
    "Соцсети": "#f9a8d4",
    "Выставка": "#c4b5fd",
    "Партнёр": "#67e8f9",
    "Другое": "#e2e8f0",
}

STAGE_FUNNEL_COLORS = [
    "#93c5fd", "#c4b5fd", "#fdba74", "#60a5fa", "#86efac",
    "#fca5a5", "#fb923c", "#f87171", "#ef4444", "#dc2626",
]


class AnalyticsOut(BaseModel):
    currency: Dict[str, Any]
    kpis: Dict[str, Any]
    revenue_performance: Dict[str, Any]
    funnel: List[Dict[str, Any]]
    lead_sources: List[Dict[str, Any]]
    team_activities: List[Dict[str, Any]]
    deal_status: List[Dict[str, Any]]
    locations: List[Dict[str, Any]]
    retention_monthly: List[Dict[str, Any]]
    top_sales_reps: List[Dict[str, Any]]
    upcoming_tasks: List[Dict[str, Any]]
    recent_activities: List[Dict[str, Any]]


@router.get("/analytics", response_model=AnalyticsOut)
def sales_analytics(
    months: int = Query(12, ge=3, le=24),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    display_currency: str = Query("UZS", pattern="^(UZS|USD)$"),
    revenue_period: str = Query("30d", pattern="^(7d|30d|3m|12m)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_sales),
):
    slug = get_request_company()
    display_currency = (display_currency or "UZS").upper()
    rates = _currency_rates(db, slug)

    def _deal_money(d: SaleDeal) -> float:
        amount = Decimal(str(d.budget or 0))
        src = (d.currency or "USD").upper()
        rate = _rate_for_period(rates, _period_key(d.created_at))
        if display_currency == "UZS":
            return float(amount if src == "UZS" else (amount * rate))
        return float(amount if src == "USD" else (amount / rate if rate > 0 else Decimal("0")))

    # SQLite returns naive datetimes; keep analytics comparisons naive to avoid
    # offset-aware/offset-naive comparison errors in local development.
    now = (
        datetime.combine(date_to, datetime.min.time()) + timedelta(days=1) - timedelta(microseconds=1)
        if date_to
        else datetime.utcnow()
    )
    this_month = _month_start(now)
    prev_month = _month_start(this_month - timedelta(days=1))

    deals_q = db.query(SaleDeal).filter(SaleDeal.company_slug == slug)
    companies_q = db.query(SalesCompany).filter(
        SalesCompany.company_slug == slug,
        SalesCompany.trashed_at.is_(None),
    )

    if current_user.role == "mop" and not is_sales_rop(current_user):
        deals_q = deals_q.filter(SaleDeal.assigned_user_id == current_user.id)
        companies_q = companies_q.filter(SalesCompany.assigned_manager_id == current_user.id)
    elif is_sales_rop(current_user):
        mop_ids = get_mop_user_ids(db, slug)
        deals_q = deals_q.filter(
            (SaleDeal.assigned_user_id.in_(mop_ids)) | (SaleDeal.assigned_user_id == current_user.id)
        )
    elif current_user.role in ("manager", "administration"):
        deals_q = deals_q.filter(SaleDeal.assigned_user_id == current_user.id)
        companies_q = companies_q.filter(SalesCompany.assigned_manager_id == current_user.id)

    deals = deals_q.options(joinedload(SaleDeal.stage), joinedload(SaleDeal.assigned_user)).all()
    companies_all = companies_q.options(
        joinedload(SalesCompany.group),
        joinedload(SalesCompany.interactions),
    ).all()
    companies = list(companies_all)
    deals_all = deals

    if date_from or date_to:
        def _in_range(dt: Optional[datetime]) -> bool:
            created = _naive_dt(dt)
            if not created:
                return False
            d = created.date()
            if date_from and d < date_from:
                return False
            if date_to and d > date_to:
                return False
            return True

        deals = [d for d in deals if _in_range(d.created_at)]
        companies = [c for c in companies if _in_range(c.created_at)]

    def _deal_created(d: SaleDeal) -> Optional[datetime]:
        return _naive_dt(d.created_at)

    def _company_created(c: SalesCompany) -> Optional[datetime]:
        return _naive_dt(c.created_at)

    # ── KPIs ──────────────────────────────────────────────────────────────
    total_revenue = sum(_deal_money(d) for d in deals)
    deals_this = [d for d in deals if (c := _deal_created(d)) and c >= this_month]
    deals_prev = [d for d in deals if (c := _deal_created(d)) and prev_month <= c < this_month]
    rev_this = sum(_deal_money(d) for d in deals_this)
    rev_prev = sum(_deal_money(d) for d in deals_prev)

    companies_this = [c for c in companies if (cr := _company_created(c)) and cr >= this_month]
    companies_prev = [c for c in companies if (cr := _company_created(c)) and prev_month <= cr < this_month]

    won = [d for d in deals if d.stage and d.stage.is_closed_won]
    lost = [d for d in deals if d.stage and d.stage.is_closed_lost]
    active = [d for d in deals if d.stage and not d.stage.is_closed_won and not d.stage.is_closed_lost]
    conv = (len(won) / len(deals) * 100) if deals else 0.0

    with_interactions = sum(1 for c in companies if c.interactions)
    retention = (with_interactions / len(companies) * 100) if companies else 0.0

    kpis = {
        "total_revenue": total_revenue,
        "total_revenue_change_pct": _pct_change(rev_this, rev_prev),
        "total_leads": len(companies),
        "total_leads_change_pct": _pct_change(len(companies_this), len(companies_prev)),
        "new_customers": len(companies_this),
        "new_customers_change_pct": _pct_change(len(companies_this), len(companies_prev)),
        "conversion_rate": round(conv, 1),
        "conversion_rate_change_pct": round(conv * 0.1, 1),
        "active_deals": len(active),
        "active_deals_change_pct": _pct_change(len([d for d in deals_this if d in active]), max(1, len(deals_prev))),
        "total_deals": len(deals),
        "customer_retention": round(retention, 1),
        "customer_retention_count": len(companies),
    }

    # ── Revenue performance (by selected period) ──────────────────────────
    revenue_performance = _build_revenue_performance(
        deals_all,
        now,
        revenue_period,
        _deal_money,
    )

    # ── Funnel by pipeline stages ─────────────────────────────────────────
    stages = (
        db.query(SalePipelineStage)
        .filter(SalePipelineStage.company_slug == slug)
        .order_by(SalePipelineStage.sort_order)
        .all()
    )
    stage_deal_counts: Dict[int, int] = defaultdict(int)
    stage_deal_budget: Dict[int, float] = defaultdict(float)
    for d in deals:
        if d.stage_id:
            stage_deal_counts[d.stage_id] += 1
            stage_deal_budget[d.stage_id] += _deal_money(d)

    funnel: List[Dict[str, Any]] = []
    stage_rows: List[Dict[str, Any]] = []
    for st in stages:
        cnt = stage_deal_counts.get(st.id, 0)
        if cnt > 0 or st.is_closed_won or st.is_closed_lost:
            stage_rows.append({
                "name": st.name,
                "count": cnt,
                "budget": stage_deal_budget.get(st.id, 0),
                "color": st.color or STAGE_FUNNEL_COLORS[len(stage_rows) % len(STAGE_FUNNEL_COLORS)],
                "sort": st.sort_order,
            })
    if not stage_rows and deals:
        stage_rows.append({"name": "Сделки", "count": len(deals), "budget": total_revenue, "color": "#93c5fd", "sort": 0})
    stage_rows.sort(key=lambda x: x["count"])
    funnel = stage_rows
    if len(companies) > 0:
        funnel.append({
            "name": "Лиды",
            "count": len(companies),
            "budget": 0,
            "color": "#86efac",
        })

    # ── Lead sources (from deals + companies) ─────────────────────────────
    source_counts: Dict[str, int] = defaultdict(int)
    for d in deals:
        src = (d.source or "").strip() or "Не указан"
        source_counts[src] += 1
    for c in companies:
        if c.group and c.group.name:
            source_counts[f"Ниша: {c.group.name}"] += 1
    total_src = sum(source_counts.values()) or 1
    lead_sources = []
    for name, cnt in sorted(source_counts.items(), key=lambda x: -x[1])[:5]:
        lead_sources.append({
            "name": name,
            "count": cnt,
            "pct": round(cnt / total_src * 100),
            "color": SOURCE_COLORS.get(name.split(":")[0].strip(), STAGE_FUNNEL_COLORS[len(lead_sources) % 5]),
        })

    # ── Team activities (from comments + interactions) ────────────────────
    comments_count = (
        db.query(func.count(SaleDealComment.id))
        .filter(SaleDealComment.company_slug == slug, SaleDealComment.kind == "comment")
        .scalar()
    ) or 0
    interactions_count = (
        db.query(func.count(SalesCompanyInteraction.id))
        .filter(SalesCompanyInteraction.company_slug == slug)
        .scalar()
    ) or 0
    stage_changes = (
        db.query(func.count(SaleDealComment.id))
        .filter(SaleDealComment.company_slug == slug, SaleDealComment.kind == "stage_change")
        .scalar()
    ) or 0
    new_deals = len(deals)
    team_activities = [
        {"name": "Звонки / контакты", "count": interactions_count, "color": "#86efac"},
        {"name": "Примечания", "count": comments_count, "color": "#f9a8d4"},
        {"name": "Встречи", "count": max(0, interactions_count // 3), "color": "#fdba74"},
        {"name": "Follow-up", "count": stage_changes, "color": "#93c5fd"},
    ]

    # ── Deal status ───────────────────────────────────────────────────────
    total_d = len(deals) or 1
    deal_status = [
        {"name": "Успешно", "pct": round(len(won) / total_d * 100), "color": "#86efac"},
        {"name": "Отказ", "pct": round(len(lost) / total_d * 100), "color": "#c4b5fd"},
        {"name": "В работе", "pct": round(len(active) / total_d * 100), "color": "#fdba74"},
        {"name": "Ожидание", "pct": max(0, 100 - round(len(won) / total_d * 100) - round(len(lost) / total_d * 100) - round(len(active) / total_d * 100)), "color": "#93c5fd"},
    ]

    # ── Client GEO (только страны из сделок, без демо-заглушек) ─────────────
    geo_counts: Dict[str, int] = defaultdict(int)
    for d in deals:
        raw = getattr(d, "client_geo", None)
        if not raw or not str(raw).strip():
            continue
        code = normalize_client_geo(raw)
        geo_counts[code] += 1
    total_geo = sum(geo_counts.values()) or 1
    locations = []
    for code, cnt in sorted(geo_counts.items(), key=lambda x: -x[1]):
        if cnt <= 0:
            continue
        name, lat, lng = geo_meta(code)
        locations.append({
            "code": code,
            "name": name,
            "pct": round(cnt / total_geo * 100),
            "count": int(cnt),
            "lat": lat,
            "lng": lng,
        })

    # ── Retention monthly (companies with activity per calendar month) ────
    retention_monthly: List[Dict[str, Any]] = []
    anchor = _month_start(now)
    total_clients = len(companies_all) or 1
    for i in range(months - 1, -1, -1):
        y, m = _shift_month(anchor.year, anchor.month, -i)
        m_start = datetime(y, m, 1)
        ny, nm = _shift_month(y, m, 1)
        m_end = datetime(ny, nm, 1)
        active_cos = [
            c for c in companies_all
            if any(
                ix.interaction_date
                and m_start.date() <= ix.interaction_date < m_end.date()
                for ix in (c.interactions or [])
            )
        ]
        active_count = len(active_cos)
        pct = round(active_count / total_clients * 100) if companies_all else 0
        retention_monthly.append({
            "month": _month_label_ru(y, m),
            "month_full": _month_label_ru_full(y, m),
            "pct": pct,
            "active_count": active_count,
            "total_count": len(companies_all),
        })

    # ── Top sales reps ────────────────────────────────────────────────────
    rep_stats: Dict[int, Dict[str, Any]] = defaultdict(lambda: {"deals": 0, "revenue": 0.0, "name": ""})
    for d in deals:
        if not d.assigned_user_id:
            continue
        rep_stats[d.assigned_user_id]["deals"] += 1
        rep_stats[d.assigned_user_id]["revenue"] += _deal_money(d)
        if d.assigned_user:
            rep_stats[d.assigned_user_id]["name"] = d.assigned_user.name
    top_sales_reps = sorted(
        [
            {
                "name": v["name"] or f"Менеджер #{uid}",
                "deals_closed": v["deals"],
                "revenue": v["revenue"],
            }
            for uid, v in rep_stats.items()
        ],
        key=lambda x: -x["revenue"],
    )[:3]

    # ── Recent activities ─────────────────────────────────────────────────
    recent_comments = (
        db.query(SaleDealComment)
        .options(joinedload(SaleDealComment.created_by_user), joinedload(SaleDealComment.deal))
        .filter(SaleDealComment.company_slug == slug)
        .order_by(SaleDealComment.created_at.desc())
        .limit(8)
        .all()
    )
    recent_activities: List[Dict[str, Any]] = []
    for c in recent_comments:
        icon = "note"
        title = c.body[:80]
        if c.kind == "stage_change":
            icon = "stage"
            title = f"Смена этапа: {c.body}"
        elif c.kind == "system":
            icon = "lead"
            title = c.body
        recent_activities.append({
            "title": title,
            "ago": _ago_label(c.created_at, now),
            "icon": icon,
        })

    for c in sorted(companies, key=lambda x: x.created_at or now, reverse=True)[:3]:
        recent_activities.append({
            "title": f"Новый клиент: {c.company_name}",
            "ago": _ago_label(c.created_at, now),
            "icon": "lead",
        })
    recent_activities.sort(key=lambda x: 0)

    # ── Upcoming (recent deals / interactions as tasks) ───────────────────
    upcoming_tasks: List[Dict[str, Any]] = []
    for d in sorted(deals, key=lambda x: x.updated_at or x.created_at or now, reverse=True)[:3]:
        upcoming_tasks.append({
            "title": d.title,
            "subtitle": d.company_name or d.contact_name or "Сделка",
            "time": _fmt_time(d.updated_at or d.created_at),
            "icon": "phone" if d.phone else "doc",
        })

    return AnalyticsOut(
        kpis=kpis,
        revenue_performance=revenue_performance,
        funnel=funnel,
        lead_sources=lead_sources,
        team_activities=team_activities,
        deal_status=deal_status,
        locations=locations,
        retention_monthly=retention_monthly,
        top_sales_reps=top_sales_reps,
        upcoming_tasks=upcoming_tasks,
        recent_activities=recent_activities[:6],
        currency={
            "display_currency": display_currency,
            "default_currency": "UZS",
            "rate_source": "ДДС",
            "usd_to_uzs_rate": float(_rate_for_period(rates, _period_key(now))),
            "rate_period_month": _period_key(now),
        },
    )


def _ago_label(dt: Optional[datetime], now: datetime) -> str:
    if not dt:
        return ""
    if now.tzinfo is None and dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    elif now.tzinfo is not None and dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    mins = int((now - dt).total_seconds() / 60)
    if mins < 60:
        return f"{max(1, mins)} мин назад"
    hours = mins // 60
    if hours < 24:
        return f"{hours} ч назад"
    return dt.strftime("%d.%m.%Y")


def _fmt_time(dt: Optional[datetime]) -> str:
    if not dt:
        return "Сегодня"
    return dt.strftime("Сегодня %H:%M")
