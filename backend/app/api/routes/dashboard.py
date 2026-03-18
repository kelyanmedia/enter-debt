from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import date
from decimal import Decimal
from app.db.database import get_db
from app.models.payment import Payment
from app.models.partner import Partner
from app.schemas.schemas import DashboardStats
from app.core.security import get_current_user

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("", response_model=DashboardStats)
def get_dashboard(db: Session = Depends(get_db), _=Depends(get_current_user)):
    today = date.today()

    total_receivable = db.query(func.sum(Payment.amount)).filter(
        Payment.status.in_(["pending", "overdue"]),
        Payment.is_archived == False
    ).scalar() or Decimal(0)

    overdue_count = db.query(func.count(Payment.id)).filter(
        Payment.status == "overdue",
        Payment.is_archived == False
    ).scalar() or 0

    pending_count = db.query(func.count(Payment.id)).filter(
        Payment.status == "pending",
        Payment.is_archived == False
    ).scalar() or 0

    paid_this_month = db.query(func.count(Payment.id)).filter(
        Payment.status == "paid",
        func.extract("month", Payment.paid_at) == today.month,
        func.extract("year", Payment.paid_at) == today.year
    ).scalar() or 0

    paid_amount_this_month = db.query(func.sum(Payment.amount)).filter(
        Payment.status == "paid",
        func.extract("month", Payment.paid_at) == today.month,
        func.extract("year", Payment.paid_at) == today.year
    ).scalar() or Decimal(0)

    partners_count = db.query(func.count(Partner.id)).filter(
        Partner.status == "active",
        Partner.is_deleted == False
    ).scalar() or 0

    return DashboardStats(
        total_receivable=total_receivable,
        overdue_count=overdue_count,
        pending_count=pending_count,
        paid_this_month=paid_this_month,
        paid_amount_this_month=paid_amount_this_month,
        partners_count=partners_count,
    )
