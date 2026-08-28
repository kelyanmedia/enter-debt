from datetime import datetime, timezone
from decimal import Decimal

from app.schemas.schemas import ReceivedPaymentRowOut
from app.services import weekly_tg_report


def _received_row(*, amount: str, partner: str, project: str, payment_id: int, paid_at: datetime):
    return ReceivedPaymentRowOut(
        kind="month_line",
        paid_at=paid_at,
        amount=Decimal(amount),
        partner_id=payment_id,
        partner_name=partner,
        payment_id=payment_id,
        project_description=project,
        service_month="2026-08",
        line_description=f"{project} Август 2026 Акт/СФ",
    )


def test_weekly_report_uses_utc_bounds_and_keeps_all_received_rows(monkeypatch):
    rows = [
        _received_row(
            amount="20000000",
            partner="Shine Bright",
            project="Интернет-магазин",
            payment_id=1,
            # 00:30 Monday in Tashkent: this was previously omitted on SQLite.
            paid_at=datetime(2026, 8, 23, 19, 30, tzinfo=timezone.utc),
        ),
        _received_row(
            amount="9000000",
            partner='ООО "SS TYRES"',
            project="Web",
            payment_id=2,
            paid_at=datetime(2026, 8, 28, 12, 30, tzinfo=timezone.utc),
        ),
    ]
    captured = {}
    sent = {}

    def fetch(_db, start, end, *, include_archived):
        captured.update(start=start, end=end, include_archived=include_archived)
        return rows

    def send(_chat_id, text):
        sent["text"] = text
        return True

    monkeypatch.setattr(weekly_tg_report, "fetch_received_payment_rows_range", fetch)
    monkeypatch.setattr(weekly_tg_report, "admin_report_chat_ids", lambda _db: [123])
    monkeypatch.setattr(weekly_tg_report, "send_telegram_html", send)
    monkeypatch.setattr(weekly_tg_report.settings, "BOT_TOKEN", "test-token")

    result = weekly_tg_report.run_weekly_cash_report(
        object(),
        now=datetime(2026, 8, 28, 18, 0, tzinfo=weekly_tg_report.TZ_TASHKENT),
    )

    assert captured == {
        "start": datetime(2026, 8, 23, 19, 0, tzinfo=timezone.utc),
        "end": datetime(2026, 8, 28, 13, 0, tzinfo=timezone.utc),
        "include_archived": True,
    }
    assert result["total"] == "29000000"
    assert result["row_count"] == 2
    assert "29 000 000,00" in sent["text"]
    assert "Shine Bright" in sent["text"]
    assert "ООО &quot;SS TYRES&quot;" in sent["text"]
    assert "00:00" in sent["text"]
    assert "18:00" in sent["text"]
