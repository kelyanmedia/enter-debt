"""CRM: план продаж по направлениям и месяцам (по менеджеру)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.database import get_db, get_request_company
from app.models.available_funds_manual import AvailableFundsManual
from app.models.sales_plan import SalesPlanCategory, SalesPlanEntry
from app.models.user import User
from app.services.sales_access import get_mop_user_ids, is_sales_rop, require_crm_pipeline

router = APIRouter(prefix="/api/sales", tags=["sales-plan"])

DEFAULT_CATEGORIES = [
    {"name": "Сайты", "color": "#3b82f6"},
    {"name": "SEO", "color": "#22c55e"},
    {"name": "PPC (контекстная реклама)", "color": "#f97316"},
    {"name": "ERP-решения", "color": "#8b5cf6"},
    {"name": "SMM", "color": "#ec4899"},
    {"name": "Прочее", "color": "#64748b"},
]

MONTHS_RU = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"]


def _require_sales(current_user: User = Depends(get_current_user)) -> User:
    return require_crm_pipeline(current_user)


def _can_browse_managers(user: User) -> bool:
    return user.role == "admin" or is_sales_rop(user)


# ── Schemas ──────────────────────────────────────────────────────────────────


class CategoryOut(BaseModel):
    id: int
    name: str
    color: str
    avg_check: Optional[int] = None
    sort_order: int
    is_archived: bool


class CategoryCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    color: str = Field("#3b82f6", max_length=20)
    avg_check: Optional[int] = None


class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    color: Optional[str] = Field(None, max_length=20)
    avg_check: Optional[int] = None
    is_archived: Optional[bool] = None
    sort_order: Optional[int] = None


class CategoryReorderIn(BaseModel):
    ids: List[int]


class MonthCell(BaseModel):
    month: int
    plan_amount: int
    fact_amount: int


class CategoryMatrixRow(BaseModel):
    category: CategoryOut
    months: List[MonthCell]
    plan_total: int
    fact_total: int


class SalesPlanOut(BaseModel):
    year: int
    manager_user_id: Optional[int] = None
    read_only: bool = False
    currency: Dict[str, Any]
    categories: List[CategoryOut]
    matrix: List[CategoryMatrixRow]
    totals: Dict[str, Any]
    kpis: Dict[str, Any]
    has_any_plan: bool


class EntryUpsertIn(BaseModel):
    category_id: int
    year: int
    month: int = Field(..., ge=1, le=12)
    plan_amount: Optional[int] = None
    fact_amount: Optional[int] = None
    manager_user_id: Optional[int] = None


class DistributeIn(BaseModel):
    category_id: int
    year: int
    annual_plan: int = Field(..., ge=0)
    field: Literal["plan", "fact"] = "plan"
    manager_user_id: Optional[int] = None


class CopyIn(BaseModel):
    year: int
    mode: Literal["prev_month", "prev_year"]
    source_month: Optional[int] = Field(None, ge=1, le=12)
    target_month: Optional[int] = Field(None, ge=1, le=12)
    field: Literal["plan", "fact", "both"] = "plan"
    manager_user_id: Optional[int] = None


# ── Helpers ───────────────────────────────────────────────────────────────────


def _usd_rate(db: Session, slug: str) -> tuple[Decimal, str]:
    today = date.today()
    period = f"{today.year:04d}-{today.month:02d}"
    rows = (
        db.query(AvailableFundsManual)
        .filter(AvailableFundsManual.company_slug == slug)
        .order_by(AvailableFundsManual.period_month.asc())
        .all()
    )
    rates = {
        r.period_month: Decimal(str(r.usd_to_uzs_rate or 0))
        for r in rows
        if Decimal(str(r.usd_to_uzs_rate or 0)) > 0
    }
    if not rates:
        return Decimal("0"), period
    if period in rates:
        return rates[period], period
    prev = [k for k in rates if k <= period]
    if prev:
        key = max(prev)
        return rates[key], key
    key = min(rates)
    return rates[key], key


def _seed_categories(db: Session, slug: str) -> List[SalesPlanCategory]:
    existing = (
        db.query(SalesPlanCategory)
        .filter(SalesPlanCategory.company_slug == slug)
        .count()
    )
    if existing > 0:
        return (
            db.query(SalesPlanCategory)
            .filter(SalesPlanCategory.company_slug == slug)
            .order_by(SalesPlanCategory.sort_order.asc(), SalesPlanCategory.id.asc())
            .all()
        )
    created: List[SalesPlanCategory] = []
    for i, spec in enumerate(DEFAULT_CATEGORIES):
        row = SalesPlanCategory(
            company_slug=slug,
            name=spec["name"],
            color=spec["color"],
            sort_order=i,
            is_archived=False,
        )
        db.add(row)
        created.append(row)
    db.commit()
    for r in created:
        db.refresh(r)
    return created


def _cat_out(c: SalesPlanCategory) -> CategoryOut:
    return CategoryOut(
        id=int(c.id),
        name=c.name,
        color=c.color or "#3b82f6",
        avg_check=int(c.avg_check) if c.avg_check is not None else None,
        sort_order=int(c.sort_order or 0),
        is_archived=bool(c.is_archived),
    )


def _resolve_manager_scope(
    db: Session,
    slug: str,
    current_user: User,
    manager_id: Optional[int],
    *,
    for_write: bool,
) -> tuple[Optional[int], bool]:
    """
    Возвращает (manager_user_id | None для агрегата, read_only).
    Обычный пользователь всегда видит/правит только свой план.
    Админ/РОП может выбрать менеджера; без id — сводка по всем (только чтение).
    """
    if not _can_browse_managers(current_user):
        return int(current_user.id), False

    if manager_id is None:
        if for_write:
            raise HTTPException(
                status_code=400,
                detail="Выберите менеджера, чтобы сохранить план",
            )
        return None, True

    target = (
        db.query(User)
        .filter(
            User.id == manager_id,
            User.company_slug == slug,
            User.is_active == True,
        )
        .first()
    )
    if not target:
        raise HTTPException(status_code=404, detail="Менеджер не найден")

    if current_user.role == "admin":
        return int(manager_id), False

    # РОП: свой план или планы МОПов
    mop_ids = get_mop_user_ids(db, slug)
    if int(manager_id) == int(current_user.id) or int(manager_id) in mop_ids:
        return int(manager_id), False
    raise HTTPException(status_code=403, detail="Нет доступа к плану этого менеджера")


def _entries_query(db: Session, slug: str, year: int, manager_user_id: Optional[int]):
    q = db.query(SalesPlanEntry).filter(
        SalesPlanEntry.company_slug == slug,
        SalesPlanEntry.year == year,
    )
    if manager_user_id is None:
        # Агрегат: все строки с привязанным менеджером (+ легаси без manager_user_id)
        return q
    return q.filter(SalesPlanEntry.manager_user_id == manager_user_id)


def _get_or_create_entry(
    db: Session,
    slug: str,
    manager_user_id: int,
    category_id: int,
    year: int,
    month: int,
) -> SalesPlanEntry:
    row = (
        db.query(SalesPlanEntry)
        .filter(
            SalesPlanEntry.company_slug == slug,
            SalesPlanEntry.manager_user_id == manager_user_id,
            SalesPlanEntry.category_id == category_id,
            SalesPlanEntry.year == year,
            SalesPlanEntry.month == month,
        )
        .first()
    )
    if row:
        return row
    row = SalesPlanEntry(
        company_slug=slug,
        manager_user_id=manager_user_id,
        category_id=category_id,
        year=year,
        month=month,
        plan_amount=0,
        fact_amount=0,
    )
    db.add(row)
    return row


def _build_plan(
    db: Session,
    slug: str,
    year: int,
    manager_user_id: Optional[int],
    read_only: bool,
) -> SalesPlanOut:
    cats = _seed_categories(db, slug)
    active = [c for c in cats if not c.is_archived]
    entries = _entries_query(db, slug, year, manager_user_id).all()

    # При агрегате суммируем ячейки с одинаковым category+month
    by_key: Dict[tuple[int, int], tuple[int, int]] = {}
    for e in entries:
        key = (int(e.category_id), int(e.month))
        plan = int(e.plan_amount or 0)
        fact = int(e.fact_amount or 0)
        prev = by_key.get(key, (0, 0))
        by_key[key] = (prev[0] + plan, prev[1] + fact)

    matrix: List[CategoryMatrixRow] = []
    month_plan = [0] * 12
    month_fact = [0] * 12
    year_plan = 0
    year_fact = 0
    has_any = False

    for c in active:
        months: List[MonthCell] = []
        p_tot = 0
        f_tot = 0
        for m in range(1, 13):
            plan, fact = by_key.get((int(c.id), m), (0, 0))
            if plan or fact:
                has_any = True
            months.append(MonthCell(month=m, plan_amount=plan, fact_amount=fact))
            p_tot += plan
            f_tot += fact
            month_plan[m - 1] += plan
            month_fact[m - 1] += fact
        year_plan += p_tot
        year_fact += f_tot
        matrix.append(
            CategoryMatrixRow(
                category=_cat_out(c),
                months=months,
                plan_total=p_tot,
                fact_total=f_tot,
            )
        )

    today = date.today()
    elapsed = today.month if today.year == year else (12 if today.year > year else 0)
    fact_to_date = sum(month_fact[:elapsed]) if elapsed else 0
    plan_to_date = sum(month_plan[:elapsed]) if elapsed else 0
    pct = round(fact_to_date / plan_to_date * 100, 1) if plan_to_date > 0 else 0.0
    forecast = round(fact_to_date / elapsed * 12) if elapsed > 0 else 0

    rate, rate_period = _usd_rate(db, slug)

    return SalesPlanOut(
        year=year,
        manager_user_id=manager_user_id,
        read_only=read_only,
        currency={
            "display_currency": "UZS",
            "default_currency": "UZS",
            "rate_source": "ДДС",
            "usd_to_uzs_rate": float(rate),
            "rate_period_month": rate_period,
        },
        categories=[_cat_out(c) for c in cats],
        matrix=matrix,
        totals={
            "by_month": [
                {"month": i + 1, "plan_amount": month_plan[i], "fact_amount": month_fact[i]}
                for i in range(12)
            ],
            "plan_total": year_plan,
            "fact_total": year_fact,
        },
        kpis={
            "plan_year": year_plan,
            "fact_to_date": fact_to_date,
            "pct_complete": pct,
            "forecast_year": forecast,
            "elapsed_months": elapsed,
        },
        has_any_plan=has_any,
    )


def _get_category(db: Session, slug: str, category_id: int) -> SalesPlanCategory:
    row = (
        db.query(SalesPlanCategory)
        .filter(SalesPlanCategory.id == category_id, SalesPlanCategory.company_slug == slug)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Направление не найдено")
    return row


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("/plan", response_model=SalesPlanOut)
def get_sales_plan(
    year: int = Query(..., ge=2000, le=2100),
    manager_user_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_sales),
):
    slug = get_request_company()
    mid, read_only = _resolve_manager_scope(
        db, slug, current_user, manager_user_id, for_write=False
    )
    return _build_plan(db, slug, year, mid, read_only)


@router.post("/plan/categories", response_model=CategoryOut)
def create_category(
    body: CategoryCreate,
    db: Session = Depends(get_db),
    _: User = Depends(_require_sales),
):
    slug = get_request_company()
    _seed_categories(db, slug)
    max_ord = (
        db.query(SalesPlanCategory)
        .filter(SalesPlanCategory.company_slug == slug)
        .count()
    )
    row = SalesPlanCategory(
        company_slug=slug,
        name=body.name.strip(),
        color=(body.color or "#3b82f6").strip(),
        avg_check=body.avg_check,
        sort_order=max_ord,
        is_archived=False,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _cat_out(row)


@router.patch("/plan/categories/{category_id}", response_model=CategoryOut)
def update_category(
    category_id: int,
    body: CategoryUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(_require_sales),
):
    slug = get_request_company()
    row = _get_category(db, slug, category_id)
    patch = body.model_dump(exclude_unset=True)
    if "name" in patch and patch["name"] is not None:
        patch["name"] = patch["name"].strip()
    if "color" in patch and patch["color"] is not None:
        patch["color"] = patch["color"].strip()
    for k, v in patch.items():
        setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return _cat_out(row)


@router.post("/plan/categories/reorder", response_model=List[CategoryOut])
def reorder_categories(
    body: CategoryReorderIn,
    db: Session = Depends(get_db),
    _: User = Depends(_require_sales),
):
    slug = get_request_company()
    cats = (
        db.query(SalesPlanCategory)
        .filter(SalesPlanCategory.company_slug == slug)
        .all()
    )
    by_id = {int(c.id): c for c in cats}
    for i, cid in enumerate(body.ids):
        if cid in by_id:
            by_id[cid].sort_order = i
    db.commit()
    refreshed = (
        db.query(SalesPlanCategory)
        .filter(SalesPlanCategory.company_slug == slug)
        .order_by(SalesPlanCategory.sort_order.asc(), SalesPlanCategory.id.asc())
        .all()
    )
    return [_cat_out(c) for c in refreshed]


@router.put("/plan/entries", response_model=MonthCell)
def upsert_entry(
    body: EntryUpsertIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_sales),
):
    slug = get_request_company()
    mid, _ = _resolve_manager_scope(
        db, slug, current_user, body.manager_user_id, for_write=True
    )
    assert mid is not None
    _get_category(db, slug, body.category_id)
    row = _get_or_create_entry(db, slug, mid, body.category_id, body.year, body.month)
    if body.plan_amount is not None:
        row.plan_amount = max(0, int(body.plan_amount))
    if body.fact_amount is not None:
        row.fact_amount = max(0, int(body.fact_amount))
    db.commit()
    db.refresh(row)
    return MonthCell(
        month=int(row.month),
        plan_amount=int(row.plan_amount or 0),
        fact_amount=int(row.fact_amount or 0),
    )


@router.post("/plan/distribute", response_model=SalesPlanOut)
def distribute_annual(
    body: DistributeIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_sales),
):
    slug = get_request_company()
    mid, read_only = _resolve_manager_scope(
        db, slug, current_user, body.manager_user_id, for_write=True
    )
    assert mid is not None
    _get_category(db, slug, body.category_id)
    total = max(0, int(body.annual_plan))
    base = total // 12
    rem = total - base * 12
    for m in range(1, 13):
        amount = base + (1 if m <= rem else 0)
        row = _get_or_create_entry(db, slug, mid, body.category_id, body.year, m)
        if body.field == "plan":
            row.plan_amount = amount
        else:
            row.fact_amount = amount
    db.commit()
    return _build_plan(db, slug, body.year, mid, read_only)


@router.post("/plan/copy", response_model=SalesPlanOut)
def copy_plan(
    body: CopyIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_sales),
):
    slug = get_request_company()
    mid, read_only = _resolve_manager_scope(
        db, slug, current_user, body.manager_user_id, for_write=True
    )
    assert mid is not None
    cats = _seed_categories(db, slug)
    active_ids = [int(c.id) for c in cats if not c.is_archived]

    if body.mode == "prev_year":
        src_year = body.year - 1
        for cid in active_ids:
            for m in range(1, 13):
                src = (
                    db.query(SalesPlanEntry)
                    .filter(
                        SalesPlanEntry.company_slug == slug,
                        SalesPlanEntry.manager_user_id == mid,
                        SalesPlanEntry.category_id == cid,
                        SalesPlanEntry.year == src_year,
                        SalesPlanEntry.month == m,
                    )
                    .first()
                )
                if not src:
                    continue
                dst = _get_or_create_entry(db, slug, mid, cid, body.year, m)
                if body.field in ("plan", "both"):
                    dst.plan_amount = int(src.plan_amount or 0)
                if body.field in ("fact", "both"):
                    dst.fact_amount = int(src.fact_amount or 0)
    else:
        src_m = body.source_month or (date.today().month - 1 or 12)
        tgt_m = body.target_month or date.today().month
        src_year = body.year
        if body.source_month is None and src_m == 12 and tgt_m == 1:
            src_year = body.year - 1
        for cid in active_ids:
            src = (
                db.query(SalesPlanEntry)
                .filter(
                    SalesPlanEntry.company_slug == slug,
                    SalesPlanEntry.manager_user_id == mid,
                    SalesPlanEntry.category_id == cid,
                    SalesPlanEntry.year == src_year,
                    SalesPlanEntry.month == src_m,
                )
                .first()
            )
            if not src:
                continue
            dst = _get_or_create_entry(db, slug, mid, cid, body.year, tgt_m)
            if body.field in ("plan", "both"):
                dst.plan_amount = int(src.plan_amount or 0)
            if body.field in ("fact", "both"):
                dst.fact_amount = int(src.fact_amount or 0)

    db.commit()
    return _build_plan(db, slug, body.year, mid, read_only)


@router.get("/plan/export")
def export_sales_plan(
    year: int = Query(..., ge=2000, le=2100),
    manager_user_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_sales),
):
    slug = get_request_company()
    mid, read_only = _resolve_manager_scope(
        db, slug, current_user, manager_user_id, for_write=False
    )
    data = _build_plan(db, slug, year, mid, read_only)
    lines = ["Направление;Тип;" + ";".join(MONTHS_RU) + ";Итого"]
    for row in data.matrix:
        plan_cells = [str(m.plan_amount) for m in row.months]
        fact_cells = [str(m.fact_amount) for m in row.months]
        lines.append(
            f"{row.category.name};План;" + ";".join(plan_cells) + f";{row.plan_total}"
        )
        lines.append(
            f"{row.category.name};Факт;" + ";".join(fact_cells) + f";{row.fact_total}"
        )
    tot = data.totals
    lines.append(
        "Итого;План;"
        + ";".join(str(x["plan_amount"]) for x in tot["by_month"])
        + f";{tot['plan_total']}"
    )
    lines.append(
        "Итого;Факт;"
        + ";".join(str(x["fact_amount"]) for x in tot["by_month"])
        + f";{tot['fact_total']}"
    )
    content = "\ufeff" + "\n".join(lines) + "\n"

    def _iter():
        yield content.encode("utf-8")

    suffix = f"-m{mid}" if mid is not None else "-all"
    return StreamingResponse(
        _iter(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="sales-plan-{year}{suffix}.csv"'
        },
    )
