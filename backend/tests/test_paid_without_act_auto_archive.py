from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.services.paid_without_act_auto_archive import should_auto_archive_payment


def _month(*, paid_at, act_issued=False, status="paid", mid=1):
    return SimpleNamespace(
        id=mid,
        status=status,
        act_issued=act_issued,
        paid_at=paid_at,
        amount=1_000_000,
    )


def _payment(*, months, pid=1, is_archived=False, trashed_at=None, status="paid"):
    return SimpleNamespace(
        id=pid,
        months=months,
        is_archived=is_archived,
        trashed_at=trashed_at,
        status=status,
    )


def test_auto_archives_fully_paid_project_without_act_after_5_minutes():
    now = datetime(2026, 7, 22, 12, 0, tzinfo=timezone.utc)
    cutoff = now - timedelta(minutes=5)
    pay = _payment(months=[
        _month(paid_at=now - timedelta(minutes=6), act_issued=False),
    ])
    assert should_auto_archive_payment(pay, cutoff) is True


def test_does_not_archive_within_5_minutes_or_when_act_marked():
    now = datetime(2026, 7, 22, 12, 0, tzinfo=timezone.utc)
    cutoff = now - timedelta(minutes=5)
    fresh = _payment(pid=1, months=[_month(paid_at=now - timedelta(minutes=2), act_issued=False)])
    with_act = _payment(pid=2, months=[_month(paid_at=now - timedelta(minutes=30), act_issued=True)])
    unpaid = _payment(pid=3, months=[
        _month(paid_at=now - timedelta(minutes=30), act_issued=False, mid=1),
        _month(paid_at=None, act_issued=False, status="pending", mid=2),
    ])
    assert should_auto_archive_payment(fresh, cutoff) is False
    assert should_auto_archive_payment(with_act, cutoff) is False
    assert should_auto_archive_payment(unpaid, cutoff) is False
