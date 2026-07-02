from datetime import date, datetime, timezone
from decimal import Decimal
from unittest.mock import MagicMock

from app.api.routes.payments import (
    effective_payment_status,
    project_calendar_due_date,
    sync_payment_status_from_months,
)


def _month(status: str, month: str = "2026-06", paid_at=None, mid: int = 1):
    m = MagicMock()
    m.id = mid
    m.month = month
    m.status = status
    m.paid_at = paid_at
    m.due_date = date(2026, 5, 25)
    m.confirmed_by = 7
    m.received_payment_method = "transfer"
    return m


def _payment(**kwargs):
    p = MagicMock()
    p.status = kwargs.get("status", "pending")
    p.months = kwargs.get("months", [])
    p.project_category = kwargs.get("project_category", "events")
    p.deadline_date = kwargs.get("deadline_date", date(2026, 5, 25))
    p.day_of_month = None
    p.paid_at = kwargs.get("paid_at")
    p.confirmed_by = None
    p.received_payment_method = None
    p.postponed_until = None
    p.is_archived = False
    p.trashed_at = None
    p.amount = Decimal("62062123")
    p.description = "Банксы"
    p.payment_type = "one_time"
    p.partner_id = 1
    p.id = 1
    p.hosting_prepaid_years = 0
    p.hosting_renewal_anchor = None
    p.remind_days_before = 3
    p.notify_accounting = True
    p.contract_months = None
    p.service_period = None
    p.contract_url = None
    p.created_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return p


def test_effective_status_paid_when_all_months_paid():
    p = _payment(months=[_month("paid", paid_at=datetime(2026, 6, 15, tzinfo=timezone.utc))])
    assert effective_payment_status(p) == "paid"


def test_effective_status_overdue_for_unpaid_past_due():
    p = _payment(months=[_month("pending")])
    assert effective_payment_status(p, today=date(2026, 7, 2)) == "overdue"


def test_sync_marks_project_paid_when_last_month_confirmed():
    paid_at = datetime(2026, 6, 15, 12, 0, tzinfo=timezone.utc)
    p = _payment(months=[_month("paid", paid_at=paid_at)])
    changed = sync_payment_status_from_months(p)
    assert changed is True
    assert p.status == "paid"
    assert p.paid_at == paid_at
    assert p.received_payment_method == "transfer"


def test_sync_reverts_paid_when_new_pending_month_added():
    p = _payment(
        status="paid",
        paid_at=datetime(2026, 6, 15, tzinfo=timezone.utc),
        months=[_month("paid", mid=1), _month("pending", month="2026-07", mid=2)],
    )
    changed = sync_payment_status_from_months(p)
    assert changed is True
    assert p.status == "pending"
    assert p.paid_at is None


def test_project_calendar_due_none_when_all_months_paid_non_hosting():
    paid_at = datetime(2026, 6, 15, tzinfo=timezone.utc)
    p = _payment(months=[_month("paid", paid_at=paid_at)])
    assert project_calendar_due_date(p, date(2026, 7, 2)) is None
