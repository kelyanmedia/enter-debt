from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, extract, select
from datetime import date, datetime
from typing import Optional, List, Tuple, Dict, Any
from decimal import Decimal
from calendar import monthrange
from app.db.database import get_db, get_request_company
from app.models.payment import Payment, PaymentMonth
from app.models.partner import Partner
from app.models.ceo_metric_override import CeoMetricOverride
from app.models.ceo_dashboard_block import CeoDashboardBlock
from app.services.ceo_layout_defaults import ensure_ceo_layout_defaults, validate_layout_blocks
from app.schemas.schemas import (
    DashboardStats,
    ReceivedPaymentRowOut,
    WeeklyCashReportSendOut,
    CeoStats,
    CeoTurnoverOut,
    CeoTurnoverPoint,
    CeoLtvOut,
    CeoLtvBucket,
    CeoClientHistoryOut,
    CeoClientHistoryPoint,
    CeoOverridePut,
    CeoLayoutOut,
    CeoLayoutBlockOut,
    CeoLayoutPut,
)
from app.core.security import get_current_user, require_admin, require_admin_or_accountant, require_admin_or_financier
from app.core.access import accessible_partner_ids, filter_payments_query, filter_partners_query, parse_visible_manager_ids
from app.models.user import User
from app.services.weekly_tg_report import run_weekly_cash_report

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

# Линии CEO-дашборда для активных проектов.
# В «активные» не включаем legacy техподдержку и хостинг/домены.
_CEO_CORE_PROJECT_CATEGORIES = (
    "smm",
    "target",
    "personal_brand",
    "content",
    "web",
    "seo",
    "ppc",
    "mobile_app",
    "events",
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
        .filter(
            CeoMetricOverride.metric == metric,
            CeoMetricOverride.year == year,
            CeoMetricOverride.company_slug == get_request_company(),
        )
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


@router.get("/received-payments", response_model=List[ReceivedPaymentRowOut])
def received_payments_cashflow(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_or_financier),
):
    """
    Все зафиксированные поступления за календарный месяц (по дате paid_at) для ДДС.
    Источники совпадают со сводкой дашборда: строки графика (PaymentMonth) и целые проекты без графика.
    """
    start_date = date(year, month, 1)
    end_date = date(year, month, monthrange(year, month)[1])
    out: List[ReceivedPaymentRowOut] = []

    q_months = (
        db.query(PaymentMonth, Payment, Partner)
        .join(Payment, Payment.id == PaymentMonth.payment_id)
        .join(Partner, Partner.id == Payment.partner_id)
        .options(joinedload(PaymentMonth.confirmed_by_user))
        .filter(
            Payment.is_archived == False,
            Payment.trashed_at.is_(None),
            Payment.company_slug == get_request_company(),
            Partner.trashed_at.is_(None),
            Partner.company_slug == get_request_company(),
            PaymentMonth.status == "paid",
            PaymentMonth.paid_at.isnot(None),
            func.date(PaymentMonth.paid_at) >= start_date,
            func.date(PaymentMonth.paid_at) <= end_date,
        )
        .order_by(Partner.name.asc(), Payment.id.asc(), PaymentMonth.paid_at.desc())
    )
    for pm, pay, part in q_months.all():
        eff = pm.amount if pm.amount is not None else pay.amount
        cu = pm.confirmed_by_user
        line_desc = (pm.description or "").strip() or None
        proj_desc = pay.description
        out.append(
            ReceivedPaymentRowOut(
                kind="month_line",
                paid_at=pm.paid_at,
                amount=eff,
                partner_id=part.id,
                partner_name=part.name,
                payment_id=pay.id,
                project_description=proj_desc,
                service_month=pm.month,
                line_description=line_desc,
                confirmed_by_id=pm.confirmed_by,
                confirmed_by_name=cu.name if cu else None,
                received_payment_method=getattr(pm, "received_payment_method", None),
            )
        )

    has_months_sq = select(PaymentMonth.payment_id).distinct()
    q_whole = (
        db.query(Payment, Partner)
        .join(Partner, Partner.id == Payment.partner_id)
        .options(joinedload(Payment.confirmed_by_user))
        .filter(
            Payment.is_archived == False,
            Payment.trashed_at.is_(None),
            Payment.company_slug == get_request_company(),
            Partner.trashed_at.is_(None),
            Partner.company_slug == get_request_company(),
            Payment.status == "paid",
            Payment.paid_at.isnot(None),
            ~Payment.id.in_(has_months_sq),
            func.date(Payment.paid_at) >= start_date,
            func.date(Payment.paid_at) <= end_date,
        )
        .order_by(Partner.name.asc(), Payment.paid_at.desc())
    )
    for pay, part in q_whole.all():
        cu = pay.confirmed_by_user
        out.append(
            ReceivedPaymentRowOut(
                kind="project_whole",
                paid_at=pay.paid_at,
                amount=pay.amount,
                partner_id=part.id,
                partner_name=part.name,
                payment_id=pay.id,
                project_description=pay.description,
                service_month=None,
                line_description=None,
                confirmed_by_id=pay.confirmed_by,
                confirmed_by_name=cu.name if cu else None,
                received_payment_method=getattr(pay, "received_payment_method", None),
            )
        )

    out.sort(key=lambda r: (r.paid_at.timestamp() if r.paid_at else 0), reverse=True)
    return out


@router.post("/weekly-cash-report/send", response_model=WeeklyCashReportSendOut)
def post_weekly_cash_report_send(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_or_financier),
):
    """
    Отправить в Telegram тот же отчёт, что и по расписанию (пт 18:00 Ташкент):
    поступления с понедельника 00:00 до min(сейчас, пятница 18:00) текущей недели.
    Получатели — все активные админы с telegram_chat_id, иначе ADMIN_TELEGRAM_CHAT_ID.
    """
    r = run_weekly_cash_report(db)
    detail = None
    if not r["ok"]:
        err = r.get("error")
        if err == "no_recipient":
            detail = "Нет получателя: привяжите Telegram администратору в профиле бота или задайте ADMIN_TELEGRAM_CHAT_ID."
        elif err == "no_bot_token":
            detail = "BOT_TOKEN не задан — отправка в Telegram недоступна."
        else:
            detail = "Не удалось доставить сообщение в Telegram (проверьте логи сервера)."
    return WeeklyCashReportSendOut(
        ok=r["ok"],
        detail=detail,
        period_start=r.get("period_start"),
        period_end=r.get("period_end"),
        total=r.get("total"),
        row_count=int(r.get("row_count", 0)),
        project_groups=int(r.get("project_groups", 0)),
        sent_to=list(r.get("sent_to") or []),
    )


def _debitor_filter_by_manager(manager_id: Optional[int], current_user: User) -> bool:
    """Админ/бухгалтерия — любой менеджер; администрация — только из своего списка."""
    if manager_id is None:
        return False
    if current_user.role in ("admin", "accountant", "financier"):
        return True
    if current_user.role == "administration":
        return manager_id in parse_visible_manager_ids(current_user)
    return False


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
    """Активные неархивные проекты по рабочим линиям для CEO Dashboard (без tech_support и hosting_domain)."""
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

    total_projects = base_q().filter(Payment.project_category.in_(_CEO_CORE_PROJECT_CATEGORIES)).count()
    # Совместимость: считаем и новые линии, и legacy slug (web/seo/ppc/mobile_app),
    # чтобы карточки CEO работали на старых и новых данных одновременно.
    web_projects = base_q().filter(Payment.project_category.in_(("smm", "web"))).count()
    seo_projects = base_q().filter(Payment.project_category.in_(("target", "seo"))).count()
    ppc_projects = base_q().filter(Payment.project_category.in_(("personal_brand", "ppc"))).count()
    mobile_app_projects = base_q().filter(Payment.project_category.in_(("content", "mobile_app"))).count()
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
    Число новых партнёров по месяцам за год — по дате добавления в систему (created_at).
    Учитываются только партнёры с is_deleted=False, у которых есть хотя бы один неархивный проект
    в линиях Web, SEO, PPC, мобильные приложения или техподдержка (как на карточках CEO;
    хостинг и домены не входят).
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

    core_partner_ids = (
        filter_payments_query(
            db.query(Payment.partner_id)
            .filter(
                Payment.is_archived == False,
                Payment.project_category.in_(_CEO_CORE_PROJECT_CATEGORIES),
            ),
            db,
            current_user,
        )
        .distinct()
    )

    q = (
        db.query(
            extract("month", Partner.created_at).label("mm"),
            func.count(Partner.id).label("cnt"),
        )
        .filter(
            Partner.is_deleted == False,
            extract("year", Partner.created_at) == y,
            Partner.id.in_(core_partner_ids),
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
        .filter(
            CeoMetricOverride.metric == body.metric,
            CeoMetricOverride.year == body.year,
            CeoMetricOverride.company_slug == get_request_company(),
        )
        .first()
    )
    if row:
        row.data = body.data
    else:
        db.add(
            CeoMetricOverride(
                company_slug=get_request_company(),
                metric=body.metric,
                year=body.year,
                data=body.data,
            )
        )
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
        .filter(
            CeoMetricOverride.metric == metric,
            CeoMetricOverride.year == year,
            CeoMetricOverride.company_slug == get_request_company(),
        )
        .first()
    )
    if row:
        db.delete(row)
        db.commit()
    return {"ok": True}


def _ceo_layout_response(db: Session) -> CeoLayoutOut:
    slug = get_request_company()
    ensure_ceo_layout_defaults(db, slug)
    rows = (
        db.query(CeoDashboardBlock)
        .filter(CeoDashboardBlock.company_slug == slug)
        .order_by(CeoDashboardBlock.sort_order.asc(), CeoDashboardBlock.id.asc())
        .all()
    )
    if not rows:
        # Редкий сбой или пустая таблица после миграции — пересоздаём дефолтную раскладку
        db.query(CeoDashboardBlock).filter(CeoDashboardBlock.company_slug == slug).delete()
        db.commit()
        ensure_ceo_layout_defaults(db, slug)
        rows = (
            db.query(CeoDashboardBlock)
            .filter(CeoDashboardBlock.company_slug == slug)
            .order_by(CeoDashboardBlock.sort_order.asc(), CeoDashboardBlock.id.asc())
            .all()
        )
    return CeoLayoutOut(
        blocks=[
            CeoLayoutBlockOut(
                id=r.id,
                kind=r.kind,
                title=r.title,
                pl_row_id=r.pl_row_id,
                sort_order=r.sort_order,
            )
            for r in rows
        ]
    )


def _persist_ceo_layout(db: Session, body: CeoLayoutPut) -> None:
    if not body.blocks:
        raise HTTPException(status_code=400, detail="Нужен хотя бы один блок")
    err = validate_layout_blocks([b.model_dump() for b in body.blocks])
    if err:
        raise HTTPException(status_code=400, detail=err)
    slug = get_request_company()
    db.query(CeoDashboardBlock).filter(CeoDashboardBlock.company_slug == slug).delete()
    for i, b in enumerate(body.blocks):
        title = (b.title or "").strip() or None
        pid = (b.pl_row_id or "").strip() or None
        if b.kind != "pl_row":
            pid = None
        db.add(
            CeoDashboardBlock(
                company_slug=slug,
                kind=b.kind,
                pl_row_id=pid,
                title=title,
                sort_order=i,
            )
        )
    db.commit()


@router.get("/ceo/layout", response_model=CeoLayoutOut)
def get_ceo_layout(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_or_accountant),
):
    """Порядок и состав блоков CEO Dashboard для текущей компании (дефолт — как на странице до настройки)."""
    return _ceo_layout_response(db)


@router.put("/ceo/layout", response_model=CeoLayoutOut)
def put_ceo_layout(
    body: CeoLayoutPut,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_or_accountant),
):
    _persist_ceo_layout(db, body)
    return _ceo_layout_response(db)


# Если nginx отрезает префикс /api (как для /finance/...), клиент должен достучаться до тех же ручек.
router_dashboard_no_api_prefix = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router_dashboard_no_api_prefix.get("/ceo/layout", response_model=CeoLayoutOut, include_in_schema=False)
def get_ceo_layout_no_api_prefix(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_or_accountant),
):
    return _ceo_layout_response(db)


@router_dashboard_no_api_prefix.put("/ceo/layout", response_model=CeoLayoutOut, include_in_schema=False)
def put_ceo_layout_no_api_prefix(
    body: CeoLayoutPut,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_or_accountant),
):
    _persist_ceo_layout(db, body)
    return _ceo_layout_response(db)
