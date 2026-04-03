import calendar
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import List, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import extract, func

from app.db.database import get_db
from app.models.user import User
from app.models.employee_task import EmployeeTask
from app.schemas.schemas import (
    EmployeeTaskCreate,
    EmployeeTaskUpdate,
    EmployeeTaskOut,
    StaffEmployeeOut,
    StaffMonthTotalsOut,
    StaffPendingPaymentMonthOut,
)
from app.core.security import get_current_user, require_admin

router = APIRouter(prefix="/api/employee-tasks", tags=["employee-tasks"])

VALID_STATUS = frozenset({"not_started", "in_progress", "pending_approval", "done"})
VALID_CURRENCY = frozenset({"USD", "UZS"})

_MONTHS_RU = (
    "Янв.",
    "Февр.",
    "Март",
    "Апр.",
    "Мая",
    "Июн.",
    "Июл.",
    "Авг.",
    "Сен.",
    "Окт.",
    "Нояб.",
    "Дек.",
)


def _require_employee_or_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in ("employee", "admin"):
        raise HTTPException(status_code=403, detail="Нет доступа")
    return current_user


def _normalize_task_budget(b: Optional[Decimal]) -> Optional[Decimal]:
    if b is None:
        return None
    if b < 0:
        raise HTTPException(status_code=400, detail="Сумма бюджета не может быть отрицательной")
    return None if b == 0 else b


def _validate_payload(data: Union[EmployeeTaskCreate, EmployeeTaskUpdate], partial: bool = False) -> None:
    st = getattr(data, "status", None)
    if st is not None and st not in VALID_STATUS:
        raise HTTPException(
            status_code=400,
            detail=f"Недопустимый статус. Допустимо: {', '.join(sorted(VALID_STATUS))}",
        )
    cur = getattr(data, "currency", None)
    if cur is not None and cur not in VALID_CURRENCY:
        raise HTTPException(status_code=400, detail="Валюта: USD или UZS")
    if not partial:
        c = getattr(data, "currency", "USD") or "USD"
        if c not in VALID_CURRENCY:
            raise HTTPException(status_code=400, detail="Валюта: USD или UZS")
    if not partial:
        _normalize_task_budget(getattr(data, "budget_amount", None))
    elif getattr(data, "budget_amount", None) is not None:
        _normalize_task_budget(data.budget_amount)


def _task_query_for_user(db: Session, uid: int, year: Optional[int], month: Optional[int]):
    q = db.query(EmployeeTask).filter(EmployeeTask.user_id == uid)
    if year is not None:
        q = q.filter(extract("year", EmployeeTask.work_date) == year)
    if month is not None:
        q = q.filter(extract("month", EmployeeTask.work_date) == month)
    return q.order_by(EmployeeTask.work_date.desc(), EmployeeTask.id.desc())


def _month_key(d: date) -> str:
    return f"{d.year}-{d.month:02d}"


def _add_one_calendar_month(d: date) -> date:
    y, m = d.year, d.month + 1
    if m > 12:
        m, y = 1, y + 1
    last = calendar.monthrange(y, m)[1]
    return date(y, m, min(d.day, last))


@router.get("/staff/employees", response_model=List[StaffEmployeeOut])
def list_staff_employees(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    rows = (
        db.query(User)
        .filter(User.role == "employee", User.is_active == True)
        .order_by(User.name)
        .all()
    )
    out: List[StaffEmployeeOut] = []
    for u in rows:
        cnt = db.query(func.count(EmployeeTask.id)).filter(EmployeeTask.user_id == u.id).scalar() or 0
        out.append(
            StaffEmployeeOut(
                id=u.id,
                name=u.name,
                email=u.email,
                payment_details=u.payment_details,
                payment_details_updated_at=u.payment_details_updated_at,
                task_count=int(cnt),
            )
        )
    return out


@router.get("/staff/month-totals", response_model=StaffMonthTotalsOut)
def staff_month_totals(
    user_id: int = Query(..., description="ID сотрудника"),
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    u = db.query(User).filter(User.id == user_id, User.role == "employee").first()
    if not u:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    rows = (
        db.query(EmployeeTask)
        .filter(
            EmployeeTask.user_id == user_id,
            extract("year", EmployeeTask.work_date) == year,
            extract("month", EmployeeTask.work_date) == month,
        )
        .all()
    )
    total_usd = Decimal(0)
    total_uzs = Decimal(0)
    total_budget_usd = Decimal(0)
    total_budget_uzs = Decimal(0)
    total_hours = Decimal(0)
    for t in rows:
        if getattr(t, "paid", False):
            continue
        if t.hours is not None:
            total_hours += Decimal(str(t.hours))
        cur = (t.currency or "USD").upper()
        if t.amount is not None:
            a = Decimal(str(t.amount))
            if cur == "UZS":
                total_uzs += a
            else:
                total_usd += a
        bud = Decimal(str(t.budget_amount or 0))
        if bud > 0:
            if cur == "UZS":
                total_budget_uzs += bud
                total_uzs += bud
            else:
                total_budget_usd += bud
                total_usd += bud
    label = f"{_MONTHS_RU[month - 1]} {year}"
    return StaffMonthTotalsOut(
        year=year,
        month=month,
        label=label,
        total_usd=total_usd,
        total_uzs=total_uzs,
        total_hours=total_hours,
        total_budget_usd=total_budget_usd,
        total_budget_uzs=total_budget_uzs,
    )


@router.get("/staff/pending-payments-summary", response_model=List[StaffPendingPaymentMonthOut])
def staff_pending_payments_summary(
    user_id: int = Query(..., description="ID сотрудника"),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    u = db.query(User).filter(User.id == user_id, User.role == "employee").first()
    if not u:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")

    rows = (
        db.query(EmployeeTask)
        .filter(EmployeeTask.user_id == user_id, EmployeeTask.paid == False)
        .order_by(EmployeeTask.work_date.desc(), EmployeeTask.id.desc())
        .all()
    )
    agg: dict[tuple[int, int], dict] = {}
    for t in rows:
        yy = int(t.work_date.year)
        mm = int(t.work_date.month)
        key = (yy, mm)
        slot = agg.get(key)
        if slot is None:
            slot = {
                "year": yy,
                "month": mm,
                "label": f"{_MONTHS_RU[mm - 1]} {yy}",
                "total_usd": Decimal(0),
                "total_uzs": Decimal(0),
                "total_budget_usd": Decimal(0),
                "total_budget_uzs": Decimal(0),
                "total_hours": Decimal(0),
                "task_count": 0,
            }
            agg[key] = slot
        slot["task_count"] += 1
        if t.hours is not None:
            slot["total_hours"] += Decimal(str(t.hours))
        cur = (t.currency or "USD").upper()
        if t.amount is not None:
            a = Decimal(str(t.amount))
            if cur == "UZS":
                slot["total_uzs"] += a
            else:
                slot["total_usd"] += a
        bud = Decimal(str(t.budget_amount or 0))
        if bud > 0:
            if cur == "UZS":
                slot["total_budget_uzs"] += bud
                slot["total_uzs"] += bud
            else:
                slot["total_budget_usd"] += bud
                slot["total_usd"] += bud

    out = [
        StaffPendingPaymentMonthOut(**slot)
        for _, slot in sorted(agg.items(), key=lambda kv: (kv[0][0], kv[0][1]), reverse=True)
    ]
    return out


@router.get("", response_model=List[EmployeeTaskOut])
def list_tasks(
    user_id: Optional[int] = Query(None, description="Только для админа: фильтр по сотруднику"),
    year: Optional[int] = Query(None, ge=2000, le=2100),
    month: Optional[int] = Query(None, ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_employee_or_admin),
):
    if current_user.role == "employee":
        if user_id is not None and user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Нельзя смотреть чужие задачи")
        uid = current_user.id
    else:
        if user_id is None:
            raise HTTPException(status_code=400, detail="Укажите user_id сотрудника")
        u = db.query(User).filter(User.id == user_id, User.role == "employee").first()
        if not u:
            raise HTTPException(status_code=404, detail="Сотрудник не найден")
        uid = user_id

    q = _task_query_for_user(db, uid, year, month)
    return [EmployeeTaskOut.model_validate(t) for t in q.all()]


@router.get("/months-with-tasks", response_model=List[int])
def list_months_with_tasks_in_year(
    year: int = Query(..., ge=2000, le=2100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Для «Мои задачи»: номера месяцев (1–12), где у сотрудника есть хотя бы одна задача за год."""
    if current_user.role != "employee":
        raise HTTPException(status_code=403, detail="Только для сотрудников")
    rows = (
        db.query(extract("month", EmployeeTask.work_date))
        .filter(
            EmployeeTask.user_id == current_user.id,
            extract("year", EmployeeTask.work_date) == year,
        )
        .distinct()
        .all()
    )
    months = sorted({int(r[0]) for r in rows if r[0] is not None})
    return months


@router.post("", response_model=EmployeeTaskOut)
def create_task(
    data: EmployeeTaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_employee_or_admin),
):
    if current_user.role == "employee":
        target_uid = current_user.id
        if data.user_id is not None and data.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Нельзя создать задачу за другого пользователя")
    elif current_user.role == "admin":
        if data.user_id is None:
            raise HTTPException(
                status_code=400,
                detail="Укажите user_id сотрудника (в разделе «Команда» он подставляется автоматически).",
            )
        u = db.query(User).filter(User.id == data.user_id, User.role == "employee", User.is_active == True).first()
        if not u:
            raise HTTPException(status_code=404, detail="Сотрудник не найден или неактивен")
        target_uid = data.user_id
    else:
        raise HTTPException(status_code=403, detail="Нет доступа")

    _validate_payload(data, partial=False)
    paid_flag = bool(data.paid) if current_user.role == "admin" else False
    st = data.status or "not_started"
    now = datetime.now(timezone.utc)
    b_norm = _normalize_task_budget(data.budget_amount)
    t = EmployeeTask(
        user_id=target_uid,
        work_date=data.work_date,
        project_name=data.project_name.strip(),
        task_description=data.task_description.strip(),
        task_url=(data.task_url or "").strip() or None,
        hours=data.hours,
        amount=data.amount,
        budget_amount=b_norm,
        currency=(data.currency or "USD").upper(),
        status=st,
        paid=paid_flag,
        done_at=now if st == "done" else None,
        paid_at=now if paid_flag else None,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return EmployeeTaskOut.model_validate(t)


@router.patch("/{task_id}", response_model=EmployeeTaskOut)
def update_task(
    task_id: int,
    data: EmployeeTaskUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_employee_or_admin),
):
    t = db.query(EmployeeTask).filter(EmployeeTask.id == task_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    if current_user.role == "employee" and t.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Нет доступа")

    _validate_payload(data, partial=True)
    upd = data.model_dump(exclude_unset=True)
    old_status = t.status
    old_paid = t.paid

    if current_user.role != "admin":
        if "paid" in upd:
            if upd["paid"] is False:
                raise HTTPException(
                    status_code=403,
                    detail="Снять отметку «Оплачено» может только администратор.",
                )
            if t.paid:
                upd.pop("paid", None)

    next_status = upd["status"] if "status" in upd else t.status
    next_paid = upd["paid"] if "paid" in upd else t.paid
    if current_user.role == "employee":
        if t.status == "done" and next_status != "done":
            raise HTTPException(
                status_code=403,
                detail="Статус «Готово» нельзя отменить самостоятельно. Обратитесь к администратору.",
            )
        if t.paid and next_paid is False:
            raise HTTPException(
                status_code=403,
                detail="Снять оплату может только администратор.",
            )

    if "project_name" in upd and upd["project_name"] is not None:
        upd["project_name"] = str(upd["project_name"]).strip()
    if "task_description" in upd and upd["task_description"] is not None:
        upd["task_description"] = str(upd["task_description"]).strip()
    if "task_url" in upd:
        v = upd["task_url"]
        upd["task_url"] = (str(v).strip() or None) if v is not None else None
    if "currency" in upd and upd["currency"] is not None:
        upd["currency"] = str(upd["currency"]).upper()
    if "budget_amount" in upd:
        upd["budget_amount"] = _normalize_task_budget(upd.get("budget_amount"))
    for k, v in upd.items():
        setattr(t, k, v)

    now = datetime.now(timezone.utc)
    if t.status == "done" and old_status != "done":
        t.done_at = now
    elif t.status != "done":
        t.done_at = None
    if t.paid and not old_paid:
        t.paid_at = now
    elif not t.paid:
        t.paid_at = None

    db.commit()
    db.refresh(t)
    return EmployeeTaskOut.model_validate(t)


@router.post("/{task_id}/move-next-month", response_model=EmployeeTaskOut)
def move_task_next_month(
    task_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Переносит задачу на следующий календарный месяц (та же строка)."""
    t = db.query(EmployeeTask).filter(EmployeeTask.id == task_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    t.work_date = _add_one_calendar_month(t.work_date)
    db.commit()
    db.refresh(t)
    return EmployeeTaskOut.model_validate(t)


@router.post("/{task_id}/duplicate-next-month", response_model=EmployeeTaskOut)
def duplicate_task_next_month(
    task_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Копия строки в следующем месяце; исходная остаётся."""
    src = db.query(EmployeeTask).filter(EmployeeTask.id == task_id).first()
    if not src:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    new_d = _add_one_calendar_month(src.work_date)
    clone = EmployeeTask(
        user_id=src.user_id,
        work_date=new_d,
        project_name=src.project_name,
        task_description=src.task_description,
        task_url=src.task_url,
        hours=src.hours,
        amount=src.amount,
        budget_amount=src.budget_amount,
        currency=(src.currency or "USD").upper(),
        status="not_started",
        paid=False,
    )
    db.add(clone)
    db.commit()
    db.refresh(clone)
    return EmployeeTaskOut.model_validate(clone)


@router.delete("/{task_id}")
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_employee_or_admin),
):
    t = db.query(EmployeeTask).filter(EmployeeTask.id == task_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    if current_user.role == "employee" and t.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Нет доступа")
    db.delete(t)
    db.commit()
    return {"ok": True}
