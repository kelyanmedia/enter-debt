from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from datetime import date, datetime, timezone
from calendar import monthrange
from app.db.database import get_db, get_request_company
from app.models.payment import Payment, PaymentMonth
from app.models.partner import Partner
from app.schemas.schemas import PaymentOut, PaymentCreate, PaymentUpdate, PaymentConfirm
from app.core.security import get_current_user, require_payment_write
from app.core.access import assert_partner_access, assert_partner_access_for_payment_delete, filter_payments_query
from app.models.user import User

router = APIRouter(prefix="/api/payments", tags=["payments"])


def _sort_payment_month_lines(months: List[PaymentMonth]) -> List[PaymentMonth]:
    """Порядок графика: период YYYY-MM, затем id (несколько строк на один месяц)."""
    return sorted(months, key=lambda m: (m.month, m.id))


def add_calendar_years(d: date, years: int) -> date:
    if years <= 0:
        return d
    y, m = d.year + years, d.month
    day = d.day
    last = monthrange(y, m)[1]
    return date(y, m, min(day, last))


def hosting_computed_next_due(p: Payment) -> Optional[date]:
    """Следующая дата учёта для хостинга: якорь + предоплата лет; иначе от последней оплаченной строки +1 год."""
    if getattr(p, "project_category", None) != "hosting_domain":
        return None
    years = int(getattr(p, "hosting_prepaid_years", None) or 0)
    anchor = getattr(p, "hosting_renewal_anchor", None) or p.deadline_date
    if anchor:
        return add_calendar_years(anchor, years)
    paid = [m for m in (p.months or []) if m.status == "paid"]
    if not paid:
        return None
    last = max(paid, key=lambda pm: (pm.month, pm.id))
    base = last.due_date
    if base is None:
        y, mo = map(int, last.month.split("-"))
        ld = monthrange(y, mo)[1]
        base = date(y, mo, ld)
    # следующий годовой цикл после оплаченного периода (якорь в форме надёжнее; предоплату без якоря не накапливаем здесь)
    return add_calendar_years(base, 1)


def sync_hosting_fields(p: Payment) -> None:
    if p.project_category != "hosting_domain":
        return
    p.service_period = "yearly"
    anchor = p.hosting_renewal_anchor
    if anchor is None and p.deadline_date is not None:
        p.hosting_renewal_anchor = p.deadline_date
        anchor = p.deadline_date
    years = int(p.hosting_prepaid_years or 0)
    years = max(0, min(3, years))
    p.hosting_prepaid_years = years
    if anchor:
        p.deadline_date = add_calendar_years(anchor, years)


def _require_hosting_has_renewal_anchor(p: Payment) -> None:
    if p.project_category != "hosting_domain":
        return
    if not (p.hosting_renewal_anchor or p.deadline_date):
        raise HTTPException(
            status_code=400,
            detail="Для хостинга/домена укажите дату следующего ежегодного продления",
        )


def _require_payment_not_trashed(p: Optional[Payment]) -> Payment:
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    if p.trashed_at is not None:
        raise HTTPException(status_code=404, detail="Проект в корзине или удалён")
    return p


def project_calendar_due_date(p: Payment, today: date) -> Optional[date]:
    """Срок «по договору» без графика месяцев: фиксированная дата или ближайший расчётный день месяца."""
    if p.status == "archived":
        return None
    # Хостинг: показываем следующее ежегодное продление даже если проект помечен «оплачен» на уровне записи
    if getattr(p, "project_category", None) == "hosting_domain":
        d = hosting_computed_next_due(p)
        if d:
            return d
        return None
    if p.status in ("paid", "archived"):
        return None
    if p.deadline_date:
        return p.deadline_date
    if p.day_of_month:
        try:
            dom = int(p.day_of_month)
            if dom < 1 or dom > 31:
                return None
            d = today.replace(day=dom) if dom >= today.day else (
                today.replace(month=today.month % 12 + 1, day=dom)
                if today.month < 12
                else today.replace(year=today.year + 1, month=1, day=dom)
            )
            return d
        except (ValueError, OverflowError):
            return None
    return None


def compute_days_until_due(p: Payment) -> Optional[int]:
    today = date.today()
    d = project_calendar_due_date(p, today)
    return (d - today).days if d else None


def load_payment(db: Session, payment_id: int) -> Payment:
    return db.query(Payment).options(
        joinedload(Payment.partner).joinedload(Partner.manager),
        joinedload(Payment.confirmed_by_user),
        joinedload(Payment.months),
    ).filter(Payment.id == payment_id, Payment.company_slug == get_request_company()).first()


def enrich(p: Payment) -> PaymentOut:
    """
    Ближайший срок для дебиторки:
    - есть неоплаченные строки графика — минимальная due_date по этим строкам (ближайший календарный срок);
    - иначе — срок проекта: deadline_date или расчётный день месяца (day_of_month).
    """
    out = PaymentOut.model_validate(p)
    today = date.today()
    unpaid = [m for m in (p.months or []) if m.status != "paid"]
    if unpaid:
        pm = min(unpaid, key=lambda m: (_due_date_for_payment_month(m, p), m.id))
        due = _due_date_for_payment_month(pm, p)
        out.next_payment_due_date = due
        out.next_payment_month = pm.month
        out.days_until_due = (due - today).days
    else:
        pdue = project_calendar_due_date(p, today)
        out.next_payment_due_date = pdue
        out.next_payment_month = None
        out.days_until_due = (pdue - today).days if pdue else None
    out.source_payment_month_id = None
    out.service_month = None
    return out


def _due_date_for_payment_month(pm: PaymentMonth, p: Payment) -> date:
    if pm.due_date:
        return pm.due_date
    y, m = pm.month.split("-")
    yi, mi = int(y), int(m)
    last_d = monthrange(yi, mi)[1]
    if p.day_of_month:
        return date(yi, mi, min(int(p.day_of_month), last_d))
    return date(yi, mi, last_d)


def enrich_as_month_line(p: Payment, pm: PaymentMonth, today: date) -> PaymentOut:
    """Одна неоплаченная строка месяца как отдельная позиция для дебиторки."""
    out = PaymentOut.model_validate(p)
    due = _due_date_for_payment_month(pm, p)
    out.deadline_date = due
    out.day_of_month = due.day
    eff = pm.amount if pm.amount is not None else p.amount
    out.amount = eff
    desc = (pm.description or "").strip()
    out.description = desc if desc else p.description
    out.status = "overdue" if due < today else "pending"
    out.days_until_due = (due - today).days
    out.next_payment_due_date = due
    out.next_payment_month = pm.month
    out.source_payment_month_id = pm.id
    out.service_month = pm.month
    out.months = []
    out.postponed_until = None
    out.paid_at = None
    return out


def enrich_paid_month_line(p: Payment, pm: PaymentMonth, today: date) -> PaymentOut:
    """Оплаченная строка месяца — в дебиторке внизу списка за тот же период."""
    out = PaymentOut.model_validate(p)
    due = _due_date_for_payment_month(pm, p)
    out.deadline_date = due
    out.day_of_month = due.day
    eff = pm.amount if pm.amount is not None else p.amount
    out.amount = eff
    desc = (pm.description or "").strip()
    out.description = desc if desc else p.description
    out.status = "paid"
    out.days_until_due = None
    out.next_payment_due_date = due
    out.next_payment_month = pm.month
    out.source_payment_month_id = pm.id
    out.service_month = pm.month
    out.months = []
    out.postponed_until = None
    out.paid_at = pm.paid_at
    return out


def _due_in_range(due: date, df: Optional[date], dt: Optional[date]) -> bool:
    if df and due < df:
        return False
    if dt and due > dt:
        return False
    return True


def _list_debitor_payments(
    db: Session,
    current_user: User,
    partner_id: Optional[int],
    payment_type: Optional[str],
    project_category: Optional[str],
    due_from: Optional[date],
    due_to: Optional[date],
) -> List[PaymentOut]:
    q = db.query(Payment).options(
        joinedload(Payment.partner).joinedload(Partner.manager),
        joinedload(Payment.confirmed_by_user),
        joinedload(Payment.months),
    ).filter(Payment.is_archived == False)
    q = filter_payments_query(q, db, current_user)
    if partner_id:
        q = q.filter(Payment.partner_id == partner_id)
    if payment_type:
        q = q.filter(Payment.payment_type == payment_type)
    if project_category:
        q = q.filter(Payment.project_category == project_category)
    payments = q.order_by(Payment.created_at.desc()).all()
    today = date.today()
    out: List[PaymentOut] = []
    for p in payments:
        months_list = p.months or []
        if len(months_list) > 0:
            for pm in _sort_payment_month_lines(months_list):
                due = _due_date_for_payment_month(pm, p)
                if not _due_in_range(due, due_from, due_to):
                    continue
                if pm.status == "paid":
                    out.append(enrich_paid_month_line(p, pm, today))
                else:
                    out.append(enrich_as_month_line(p, pm, today))
        else:
            if p.status in ("paid", "archived"):
                continue
            list_due = hosting_computed_next_due(p) if p.project_category == "hosting_domain" else p.deadline_date
            if list_due:
                if not _due_in_range(list_due, due_from, due_to):
                    continue
            else:
                ca = p.created_at.date() if isinstance(p.created_at, datetime) else p.created_at
                if not _due_in_range(ca, due_from, due_to):
                    continue
            line = enrich(p)
            out.append(line)
    return out


@router.get("", response_model=List[PaymentOut])
def list_payments(
    status: Optional[str] = None,
    partner_id: Optional[int] = None,
    payment_type: Optional[str] = None,
    project_category: Optional[str] = None,
    expand_month_lines: bool = Query(
        False,
        description="Развернуть неоплаченные строки payment_months в отдельные позиции (срок — due_date строки)",
    ),
    debitor: bool = Query(
        False,
        description="Режим дебиторки: строки графика (все месяцы) с сроком оплаты в интервале due_from–due_to; оплаченные включены",
    ),
    due_from: Optional[date] = Query(None, description="Начало периода по дате срока оплаты (debitor=1)"),
    due_to: Optional[date] = Query(None, description="Конец периода по дате срока оплаты (debitor=1)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if debitor:
        return _list_debitor_payments(
            db, current_user, partner_id, payment_type, project_category, due_from, due_to
        )

    q = db.query(Payment).options(
        joinedload(Payment.partner).joinedload(Partner.manager),
        joinedload(Payment.confirmed_by_user),
        joinedload(Payment.months),
    ).filter(Payment.is_archived == False)
    q = filter_payments_query(q, db, current_user)
    if partner_id:
        q = q.filter(Payment.partner_id == partner_id)
    if payment_type:
        q = q.filter(Payment.payment_type == payment_type)
    if project_category:
        q = q.filter(Payment.project_category == project_category)

    use_expand = expand_month_lines and status in ("pending", "overdue")
    if status and not use_expand:
        q = q.filter(Payment.status == status)

    payments = q.order_by(Payment.created_at.desc()).all()
    today = date.today()

    if not use_expand:
        return [enrich(p) for p in payments]

    out: List[PaymentOut] = []
    for p in payments:
        unpaid = [m for m in (p.months or []) if m.status != "paid"]
        if unpaid:
            for pm in _sort_payment_month_lines(unpaid):
                line = enrich_as_month_line(p, pm, today)
                if line.status != status:
                    continue
                out.append(line)
        else:
            if p.status == status:
                out.append(enrich(p))
    return out


@router.get("/{payment_id}", response_model=PaymentOut)
def get_payment(payment_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    p = load_payment(db, payment_id)
    p = _require_payment_not_trashed(p)
    assert_partner_access(db, current_user, p.partner_id)
    return enrich(p)


@router.post("", response_model=PaymentOut)
def create_payment(
    data: PaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_payment_write),
):
    assert_partner_access(db, current_user, data.partner_id)
    dump = data.model_dump()
    dump["company_slug"] = get_request_company()
    payment = Payment(**dump)
    sync_hosting_fields(payment)
    _require_hosting_has_renewal_anchor(payment)
    db.add(payment)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Не удалось сохранить проект (конфликт данных). Обновите страницу и выберите партнёра из списка.",
        )
    p = load_payment(db, payment.id)
    if not p:
        raise HTTPException(status_code=500, detail="Проект создан, но не удалось загрузить ответ. Обновите страницу.")
    # emit в отдельной сессии — не трогает текущую db
    from app.services.feed_events import emit_payment_created
    emit_payment_created(payment.id, payment.partner_id, data.description)
    return enrich(p)


@router.put("/{payment_id}", response_model=PaymentOut)
def update_payment(
    payment_id: int,
    data: PaymentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_payment_write),
):
    p = load_payment(db, payment_id)
    p = _require_payment_not_trashed(p)
    assert_partner_access(db, current_user, p.partner_id)
    upd = data.model_dump(exclude_unset=True)
    if "partner_id" in upd:
        assert_partner_access(db, current_user, upd["partner_id"])
    for field, value in upd.items():
        setattr(p, field, value)
    if "partner_id" in upd:
        pr = (
            db.query(Partner)
            .filter(Partner.id == p.partner_id, Partner.company_slug == get_request_company())
            .first()
        )
        if pr:
            p.company_slug = pr.company_slug
    sync_hosting_fields(p)
    _require_hosting_has_renewal_anchor(p)
    db.commit()
    p = load_payment(db, payment_id)
    return enrich(p)


@router.post("/{payment_id}/confirm", response_model=PaymentOut)
def confirm_payment(
    payment_id: int,
    data: PaymentConfirm,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    p = load_payment(db, payment_id)
    p = _require_payment_not_trashed(p)
    assert_partner_access(db, current_user, p.partner_id)
    if data.postpone_days and data.postpone_days > 0:
        from datetime import timedelta
        p.postponed_until = date.today() + timedelta(days=data.postpone_days)
        p.status = "postponed"
    else:
        p.status = "paid"
        p.paid_at = datetime.utcnow()
        p.confirmed_by = current_user.id
        p.postponed_until = None
        p.received_payment_method = data.received_payment_method or "transfer"
    db.commit()
    p = load_payment(db, payment_id)
    return enrich(p)


@router.delete("/{payment_id}")
def delete_payment(
    payment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_payment_write),
):
    p = load_payment(db, payment_id)
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    if p.trashed_at is not None:
        raise HTTPException(status_code=404, detail="Проект уже в корзине")
    assert_partner_access_for_payment_delete(db, current_user, p.partner_id)
    p.trashed_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}
