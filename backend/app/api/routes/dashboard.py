from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import date, datetime
from typing import Optional
from decimal import Decimal
from app.db.database import get_db
from app.models.payment import Payment
from app.models.partner import Partner
from app.schemas.schemas import DashboardStats
from app.core.security import get_current_user

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("", response_model=DashboardStats)
def get_dashboard(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user)
):
    today = date.today()

    # Base filter for active (non-archived) payments in the period
    def period_filter(q, use_created_at=True):
        q = q.filter(Payment.is_archived == False)
        if date_from and use_created_at:
            q = q.filter(func.date(Payment.created_at) >= date_from)
        if date_to and use_created_at:
            q = q.filter(func.date(Payment.created_at) <= date_to)
        return q

    def paid_period_filter(q):
        q = q.filter(Payment.is_archived == False)
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
    paid_amount_q = db.query(func.sum(Payment.amount)).filter(Payment.status == "paid")

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
