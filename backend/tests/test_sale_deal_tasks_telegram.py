from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.services.sale_deal_tasks_telegram import (
    build_task_message,
    postpone_delta,
    task_reply_markup,
)


def _task(**overrides):
    values = {
        "id": 42,
        "company_slug": "whiteway",
        "deal_id": 7,
        "task_type": "call",
        "notes": "Позвонить <директору>",
        "due_at": datetime(2026, 7, 20, 9, 30, tzinfo=timezone.utc),
        "remind_minutes_before": 15,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_task_message_escapes_html_and_describes_updated_deadline():
    text = build_task_message(
        _task(),
        SimpleNamespace(title="Клиент <важный>"),
        kind="updated",
    )

    assert "Срок задачи изменён" in text
    assert "Клиент &lt;важный&gt;" in text
    assert "Позвонить &lt;директору&gt;" in text


def test_task_buttons_include_company_for_multi_company_callback():
    markup = task_reply_markup(_task())
    callbacks = [
        button["callback_data"]
        for row in markup["inline_keyboard"]
        for button in row
    ]

    assert callbacks == [
        "sdt:done:42:whiteway",
        "sdt:tmr:42:whiteway",
        "sdt:wk:42:whiteway",
        "sdt:mo:42:whiteway",
    ]
    assert all(len(value.encode("utf-8")) <= 64 for value in callbacks)


def test_postpone_presets():
    assert postpone_delta("tmr") == timedelta(days=1)
    assert postpone_delta("wk") == timedelta(days=7)
    assert postpone_delta("mo") == timedelta(days=30)
    assert postpone_delta("unknown") is None
