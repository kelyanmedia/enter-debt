from datetime import date
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


def _task_query_for_user(db: Session, uid: int, year: Optional[int], month: Optional[int]):
    q = db.query(EmployeeTask).filter(EmployeeTask.user_id == uid)
    if year is not None:
        q = q.filter(extract("year", EmployeeTask.work_date) == year)
    if month is not None:
        q = q.filter(extract("month", EmployeeTask.work_date) == month)
    return q.order_by(EmployeeTask.work_date.desc(), EmployeeTask.id.desc())


def _month_key(d: date) -> str:
    return f"{d.year}-{d.month:02d}"


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
    total_hours = Decimal(0)
    for t in rows:
        if t.hours is not None:
            total_hours += Decimal(str(t.hours))
        if t.amount is not None:
            a = Decimal(str(t.amount))
            if (t.currency or "USD").upper() == "UZS":
                total_uzs += a
            else:
                total_usd += a
    label = f"{_MONTHS_RU[month - 1]} {year}"
    return StaffMonthTotalsOut(
        year=year,
        month=month,
        label=label,
        total_usd=total_usd,
        total_uzs=total_uzs,
        total_hours=total_hours,
    )


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
    t = EmployeeTask(
        user_id=target_uid,
        work_date=data.work_date,
        project_name=data.project_name.strip(),
        task_description=data.task_description.strip(),
        task_url=(data.task_url or "").strip() or None,
        hours=data.hours,
        amount=data.amount,
        currency=(data.currency or "USD").upper(),
        status=data.status or "not_started",
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
    if "project_name" in upd and upd["project_name"] is not None:
        upd["project_name"] = str(upd["project_name"]).strip()
    if "task_description" in upd and upd["task_description"] is not None:
        upd["task_description"] = str(upd["task_description"]).strip()
    if "task_url" in upd:
        v = upd["task_url"]
        upd["task_url"] = (str(v).strip() or None) if v is not None else None
    if "currency" in upd and upd["currency"] is not None:
        upd["currency"] = str(upd["currency"]).upper()
    for k, v in upd.items():
        setattr(t, k, v)
    db.commit()
    db.refresh(t)
    return EmployeeTaskOut.model_validate(t)


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
