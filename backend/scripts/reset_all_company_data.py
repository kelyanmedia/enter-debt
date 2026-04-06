#!/usr/bin/env python3
"""
Удаляет все таблицы SQLAlchemy во всех БД компаний (см. app.db.database).
После запуска перезапустите API — выполнится create_all, миграции и seed.

Для режима SQLite с DATABASE_SEPARATE_DBS=true можно вместо этого удалить файлы:
  data_kelyanmedia.db, data_whiteway.db, data_enter_group_media.db
в каталоге backend/ (сервер остановлен).
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Регистрация моделей на Base (как в app.main)
from app.db.database import Base, iter_company_engines  # noqa: E402

import app.models.user  # noqa: F401
import app.models.partner  # noqa: F401
import app.models.payment  # noqa: F401
import app.models.telegram_join  # noqa: F401
import app.models.feed_notification  # noqa: F401
import app.models.ceo_metric_override  # noqa: F401
import app.models.commission  # noqa: F401
import app.models.employee_task  # noqa: F401
import app.models.subscription_item  # noqa: F401
import app.models.employee_payment_record  # noqa: F401
import app.models.access_entry  # noqa: F401
import app.models.cash_flow  # noqa: F401
import app.models.available_funds_manual  # noqa: F401


def main() -> None:
    for slug, eng in iter_company_engines():
        print(f"drop_all [{slug}] …")
        Base.metadata.drop_all(bind=eng)
    print("Готово. Перезапустите uvicorn.")


if __name__ == "__main__":
    main()
