"""История выплат сотрудникам (freelance): запись сотрудником или админом, чек по желанию."""
from __future__ import annotations

import re
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.database import get_db
from app.models.employee_payment_record import EmployeePaymentRecord
from app.models.user import User
from app.schemas.schemas import EmployeePaymentRecordOut, EmployeePayrollExpenseOut

router = APIRouter(prefix="/api/employee-payment-records", tags=["employee-payment-records"])

VALID_CURRENCY = frozenset({"USD", "UZS"})
MAX_RECEIPT_BYTES = 10 * 1024 * 1024
ALLOWED_EXT = frozenset({".pdf", ".png", ".jpg", ".jpeg", ".webp"})

UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent.parent / "uploads" / "employee_payment_receipts"


def _record_out(r: EmployeePaymentRecord) -> EmployeePaymentRecordOut:
    return EmployeePaymentRecordOut(
        id=r.id,
        user_id=r.user_id,
        paid_on=r.paid_on,
        period_year=r.period_year,
        period_month=r.period_month,
        amount=Decimal(str(r.amount)),
        budget_amount=Decimal(str(getattr(r, "budget_amount", 0) or 0)),
        currency=(r.currency or "USD").upper(),
        note=r.note,
        has_receipt=bool(r.receipt_path),
        entered_by="admin" if r.created_by_user_id is not None else "self",
        created_at=r.created_at,
    )


def _parse_date(s: str) -> date:
    s = (s or "").strip()
    try:
        return date.fromisoformat(s[:10])
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Некорректная дата выплаты") from e


def _parse_amount(s: str) -> Decimal:
    s = (s or "").strip().replace(",", ".").replace(" ", "")
    if not s:
        raise HTTPException(status_code=400, detail="Укажите сумму")
    try:
        a = Decimal(s)
    except Exception as e:
        raise HTTPException(status_code=400, detail="Некорректная сумма") from e
    if a <= 0:
        raise HTTPException(status_code=400, detail="Сумма должна быть больше нуля")
    return a


def _parse_budget_part(s: Optional[str], total: Decimal) -> Decimal:
    """Доля проходного бюджета в той же выплате; не больше total."""
    raw = (s or "").strip().replace(",", ".").replace(" ", "")
    if not raw:
        return Decimal(0)
    try:
        b = Decimal(raw)
    except Exception as e:
        raise HTTPException(status_code=400, detail="Некорректная сумма бюджета") from e
    if b < 0:
        raise HTTPException(status_code=400, detail="Бюджет не может быть отрицательным")
    if b > total:
        raise HTTPException(status_code=400, detail="Бюджет не может превышать общую сумму выплаты")
    return b


def _ext_from_filename(name: str) -> str:
    lower = (name or "").lower()
    for ext in sorted(ALLOWED_EXT, key=len, reverse=True):
        if lower.endswith(ext):
            return ext
    raise HTTPException(
        status_code=400,
        detail="Чек: допустимы PDF, PNG, JPG, JPEG, WEBP",
    )


def _ensure_upload_dir() -> None:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def _resolve_receipt_path(stored: str) -> Path:
    if not stored or ".." in stored or "/" in stored or "\\" in stored:
        raise HTTPException(status_code=400, detail="Некорректный файл")
    p = UPLOAD_DIR / stored
    if not p.is_file():
        raise HTTPException(status_code=404, detail="Файл не найден")
    return p


@router.get("", response_model=List[EmployeePaymentRecordOut])
def list_payment_records(
    user_id: Optional[int] = Query(None, description="Только админ: ID сотрудника"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role == "employee":
        if user_id is not None and user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Нет доступа")
        uid = current_user.id
    elif current_user.role == "admin":
        if user_id is None:
            raise HTTPException(status_code=400, detail="Укажите user_id сотрудника")
        uid = user_id
    else:
        raise HTTPException(status_code=403, detail="Нет доступа")

    u = db.query(User).filter(User.id == uid, User.role == "employee", User.is_active == True).first()
    if not u:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")

    rows = (
        db.query(EmployeePaymentRecord)
        .filter(EmployeePaymentRecord.user_id == uid)
        .order_by(EmployeePaymentRecord.paid_on.desc(), EmployeePaymentRecord.id.desc())
        .all()
    )
    return [_record_out(r) for r in rows]


@router.get("/payroll-expenses", response_model=List[EmployeePayrollExpenseOut])
def list_payroll_expenses_for_finance(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Все выплаты сотрудникам, созданные администратором (раздел «Расходы»). Данные в БД текущей компании (X-Company-Slug)."""
    if current_user.role not in ("admin", "financier"):
        raise HTTPException(status_code=403, detail="Нет доступа")

    rows = (
        db.query(EmployeePaymentRecord, User.name)
        .join(User, User.id == EmployeePaymentRecord.user_id)
        .filter(User.role == "employee")
        .filter(EmployeePaymentRecord.created_by_user_id.isnot(None))
        .order_by(EmployeePaymentRecord.paid_on.desc(), EmployeePaymentRecord.id.desc())
        .all()
    )
    out: List[EmployeePayrollExpenseOut] = []
    for r, employee_name in rows:
        amt = Decimal(str(r.amount))
        bud = Decimal(str(getattr(r, "budget_amount", 0) or 0))
        op = amt - bud
        if op < 0:
            op = Decimal(0)
        out.append(
            EmployeePayrollExpenseOut(
                id=r.id,
                user_id=r.user_id,
                employee_name=employee_name or "—",
                paid_on=r.paid_on,
                period_year=r.period_year,
                period_month=r.period_month,
                amount=amt,
                budget_amount=bud,
                operating_amount=op,
                currency=(r.currency or "USD").upper(),
                note=r.note,
                has_receipt=bool(r.receipt_path),
                created_at=r.created_at,
            )
        )
    return out


@router.post("", response_model=EmployeePaymentRecordOut)
async def create_payment_record(
    paid_on: str = Form(...),
    amount: str = Form(...),
    currency: str = Form("USD"),
    budget_amount: Optional[str] = Form(None),
    note: Optional[str] = Form(None),
    period_year: Optional[str] = Form(None),
    period_month: Optional[str] = Form(None),
    user_id: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cur = (currency or "USD").strip().upper()
    if cur not in VALID_CURRENCY:
        raise HTTPException(status_code=400, detail="Валюта: USD или UZS")

    d = _parse_date(paid_on)
    amt = _parse_amount(amount)
    bud_amt = (
        _parse_budget_part(budget_amount, amt)
        if current_user.role == "admin"
        else Decimal(0)
    )

    py: Optional[int] = None
    pm: Optional[int] = None
    if period_year and str(period_year).strip():
        try:
            py = int(str(period_year).strip())
            if py < 2000 or py > 2100:
                raise ValueError
        except ValueError:
            raise HTTPException(status_code=400, detail="Некорректный год периода")
    if period_month and str(period_month).strip():
        try:
            pm = int(str(period_month).strip())
            if pm < 1 or pm > 12:
                raise ValueError
        except ValueError:
            raise HTTPException(status_code=400, detail="Некорректный месяц периода")
    if (py is None) != (pm is None):
        raise HTTPException(status_code=400, detail="Укажите и месяц, и год периода — или оставьте оба пустыми")

    target_uid: int
    created_by: Optional[int] = None
    note_t: Optional[str]

    if current_user.role == "admin":
        if not user_id or not str(user_id).strip().isdigit():
            raise HTTPException(status_code=400, detail="Укажите сотрудника (user_id)")
        target_uid = int(str(user_id).strip())
        created_by = current_user.id
        note_t = (note or "").strip()
        if len(note_t) < 2:
            raise HTTPException(status_code=400, detail="Укажите, за что выплата (комментарий)")
    elif current_user.role == "employee":
        target_uid = current_user.id
        created_by = None
        note_t = (note or "").strip() or None
    else:
        raise HTTPException(status_code=403, detail="Нет доступа")

    target = db.query(User).filter(User.id == target_uid, User.role == "employee", User.is_active == True).first()
    if not target:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")

    receipt_name: Optional[str] = None
    if file is not None and file.filename:
        body = await file.read()
        if len(body) > MAX_RECEIPT_BYTES:
            raise HTTPException(status_code=400, detail="Файл чека не больше 10 МБ")
        ext = _ext_from_filename(file.filename)
        safe = f"{uuid.uuid4().hex}{ext}"
        _ensure_upload_dir()
        full = UPLOAD_DIR / safe
        full.write_bytes(body)
        receipt_name = safe

    row = EmployeePaymentRecord(
        user_id=target_uid,
        paid_on=d,
        period_year=py,
        period_month=pm,
        amount=amt,
        budget_amount=bud_amt,
        currency=cur,
        note=note_t,
        receipt_path=receipt_name,
        created_by_user_id=created_by,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _record_out(row)


@router.delete("/{record_id}")
def delete_payment_record(
    record_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = db.query(EmployeePaymentRecord).filter(EmployeePaymentRecord.id == record_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Запись не найдена")

    if current_user.role == "employee":
        if row.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Нет доступа")
        if row.created_by_user_id is not None:
            raise HTTPException(
                status_code=403,
                detail="Запись от администратора может удалить только администратор",
            )
    elif current_user.role == "admin":
        u = db.query(User).filter(User.id == row.user_id, User.role == "employee").first()
        if not u:
            raise HTTPException(status_code=404, detail="Сотрудник не найден")
    else:
        raise HTTPException(status_code=403, detail="Нет доступа")

    if row.receipt_path:
        try:
            p = UPLOAD_DIR / row.receipt_path
            if p.is_file():
                p.unlink()
        except OSError:
            pass
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/{record_id}/receipt")
def download_receipt(
    record_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = db.query(EmployeePaymentRecord).filter(EmployeePaymentRecord.id == record_id).first()
    if not row or not row.receipt_path:
        raise HTTPException(status_code=404, detail="Чек не прикреплён")

    if current_user.role == "employee":
        if row.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Нет доступа")
    elif current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Нет доступа")

    path = _resolve_receipt_path(row.receipt_path)
    ext = path.suffix.lower()
    media = "application/octet-stream"
    if ext == ".pdf":
        media = "application/pdf"
    elif ext in (".png", ".jpg", ".jpeg", ".webp"):
        media = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}[ext]
    safe_name = re.sub(r"[^a-zA-Z0-9._-]", "_", f"receipt_{record_id}{ext}") or f"receipt_{record_id}"
    return FileResponse(path, media_type=media, filename=safe_name)
