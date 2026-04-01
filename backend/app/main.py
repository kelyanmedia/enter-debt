import logging
from typing import Optional

from apscheduler.schedulers.background import BackgroundScheduler
from zoneinfo import ZoneInfo
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from starlette.responses import JSONResponse

from app.core.companies import normalize_company_slug
from app.db.database import (
    Base,
    iter_company_engines,
    iter_company_sessionmakers,
    is_registered_company_slug,
    reset_company_context,
    set_company_context,
)
from app.models import user, partner, payment
import app.models.telegram_join  # noqa: F401 — таблица telegram_join_requests
import app.models.feed_notification  # noqa: F401 — лента событий
import app.models.ceo_metric_override  # noqa: F401 — ручные значения CEO dashboard
from app.api.routes import auth, users, partners, payments, dashboard, notifications, archive, payment_months, telegram_join, feed_notifications, contract_requests, employee_tasks
from app.api.routes import commissions
import app.models.commission  # noqa: F401
import app.models.employee_task  # noqa: F401
from app.core.config import settings
from app.core.security import get_password_hash

app = FastAPI(title="EnterDebt API", version="1.0.0", redirect_slashes=False)


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def api_root():
    """Подсказка в браузере: :8000 — API, панель на :3000."""
    return """<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>EnterDebt API</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:40px auto;padding:0 20px;color:#1e293b;line-height:1.55}
h1{font-size:1.2rem;font-weight:700}
a{color:#1a6b3c}
ul{padding-left:1.15rem}
.note{color:#64748b;font-size:.875rem;margin-top:1.75rem;border-top:1px solid #e2e8f0;padding-top:1rem}
code{background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:.9em}
</style>
</head>
<body>
<h1>Это API (порт 8000)</h1>
<p>Страница <code>/health</code> отдаёт только JSON — в браузере может выглядеть «пусто»; так и нужно для проверки сервера.</p>
<p><strong>Веб-панель</strong> запускается отдельно:</p>
<ul>
  <li><a href="http://127.0.0.1:3000/login">Войти в панель</a> — Next.js, обычно порт <strong>3000</strong></li>
  <li><a href="/docs">Документация API (/docs)</a></li>
  <li><a href="/health">/health</a> (JSON)</li>
</ul>
<p class="note">Сначала поднимите бэкенд (uvicorn), затем в другом терминале <code>npm run dev</code> в папке frontend.</p>
</body>
</html>"""


_scheduler: Optional[BackgroundScheduler] = None
log = logging.getLogger(__name__)


def _weekly_tg_report_job():
    from app.services.weekly_tg_report import run_weekly_cash_report

    for slug, Session in iter_company_sessionmakers():
        db = Session()
        tok = set_company_context(slug)
        try:
            r = run_weekly_cash_report(db)
            log.info("Weekly cash Telegram report [%s]: %s", slug, r)
        except Exception:
            log.exception("Weekly cash Telegram report failed [%s]", slug)
        finally:
            db.close()
            reset_company_context(tok)


@app.middleware("http")
async def company_context_middleware(request: Request, call_next):
    if request.method == "OPTIONS":
        return await call_next(request)
    raw = request.headers.get("x-company-slug")
    slug = normalize_company_slug(raw)
    if not is_registered_company_slug(slug):
        return JSONResponse(
            status_code=400,
            content={
                "detail": (
                    f"Неизвестная компания. Укажите заголовок X-Company-Slug "
                    f"(kelyanmedia, whiteway, enter_group_media)."
                )
            },
        )
    token = set_company_context(slug)
    try:
        return await call_next(request)
    finally:
        reset_company_context(token)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(partners.router)
app.include_router(payments.router)
app.include_router(dashboard.router)
app.include_router(notifications.router)
app.include_router(feed_notifications.router)
app.include_router(archive.router)
app.include_router(payment_months.router)
app.include_router(telegram_join.router)
app.include_router(contract_requests.router)
app.include_router(employee_tasks.router)
app.include_router(commissions.router)


@app.on_event("startup")
def startup():
    global _scheduler
    for _, eng in iter_company_engines():
        Base.metadata.create_all(bind=eng)
    _migrate()
    seed_initial_data()
    try:
        _scheduler = BackgroundScheduler(timezone=ZoneInfo("Asia/Tashkent"))
        _scheduler.add_job(
            _weekly_tg_report_job,
            "cron",
            day_of_week="fri",
            hour=18,
            minute=0,
            id="weekly_cash_telegram",
            replace_existing=True,
        )
        _scheduler.start()
        log.info("APScheduler: weekly cash report — пт 18:00 Asia/Tashkent")
    except Exception as e:
        log.warning("APScheduler not started: %s", e)


@app.on_event("shutdown")
def shutdown_scheduler():
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None


def _migrate():
    """Idempotent column additions for existing deployments."""
    import logging
    from sqlalchemy import text
    log = logging.getLogger(__name__)
    migrations = [
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS web_access BOOLEAN DEFAULT TRUE",
        "UPDATE users SET web_access = TRUE WHERE web_access IS NULL",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS see_all_partners BOOLEAN DEFAULT FALSE",
        "UPDATE users SET see_all_partners = FALSE WHERE see_all_partners IS NULL",
        "ALTER TABLE payments ADD COLUMN IF NOT EXISTS contract_months INTEGER",
        "ALTER TABLE payments ADD COLUMN IF NOT EXISTS notify_accounting BOOLEAN DEFAULT TRUE",
        "ALTER TABLE payments ADD COLUMN IF NOT EXISTS contract_url VARCHAR(500)",
        "ALTER TABLE payments ADD COLUMN IF NOT EXISTS service_period VARCHAR(20)",
        "ALTER TABLE payment_months ADD COLUMN IF NOT EXISTS description VARCHAR(300)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS feed_cleared_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE payments ADD COLUMN IF NOT EXISTS project_category VARCHAR(20)",
        "ALTER TABLE payment_months ADD COLUMN IF NOT EXISTS act_issued BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE payment_months ADD COLUMN IF NOT EXISTS act_issued_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE payment_months ADD COLUMN IF NOT EXISTS due_date DATE",
        "ALTER TABLE payment_months ADD COLUMN IF NOT EXISTS confirmed_by INTEGER REFERENCES users(id)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS visible_manager_ids TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_details TEXT",
        """CREATE TABLE IF NOT EXISTS employee_tasks (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            work_date DATE NOT NULL,
            project_name VARCHAR(300) NOT NULL,
            task_description VARCHAR(600) NOT NULL,
            task_url VARCHAR(800),
            hours NUMERIC(10,2),
            amount NUMERIC(15,2),
            currency VARCHAR(3) NOT NULL DEFAULT 'USD',
            status VARCHAR(30) NOT NULL DEFAULT 'not_started',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE
        )""",
        # Commissions table
        """CREATE TABLE IF NOT EXISTS commissions (
            id SERIAL PRIMARY KEY,
            project_name VARCHAR(300) NOT NULL,
            project_type VARCHAR(20) NOT NULL,
            project_cost NUMERIC(15,2) NOT NULL,
            production_cost NUMERIC(15,2) NOT NULL DEFAULT 0,
            manager_percent NUMERIC(5,2) NOT NULL,
            actual_payment NUMERIC(15,2),
            received_amount_1 NUMERIC(15,2),
            received_amount_2 NUMERIC(15,2),
            commission_paid_full BOOLEAN NOT NULL DEFAULT FALSE,
            project_date DATE NOT NULL,
            note VARCHAR(500),
            manager_id INTEGER NOT NULL REFERENCES users(id),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE
        )""",
        "ALTER TABLE partners ADD COLUMN IF NOT EXISTS cooperation_start_date DATE",
        "ALTER TABLE partners ADD COLUMN IF NOT EXISTS client_joined_date DATE",
        "UPDATE partners SET partner_type = 'A' WHERE partner_type IN ('regular', 'recurring')",
        "UPDATE partners SET partner_type = 'B' WHERE partner_type = 'one_time'",
        "UPDATE partners SET partner_type = 'C' WHERE partner_type = 'service'",
    ]
    for sql in migrations:
        # Защита от случайного удаления данных
        su = sql.upper()
        forbidden = any(kw in su for kw in ("DROP", "TRUNCATE", "ALTER TABLE USERS SET")) or "DELETE FROM" in su
        if forbidden:
            log.error(f"MIGRATION BLOCKED (destructive SQL): {sql[:80]}")
            continue
        for _slug, eng in iter_company_engines():
            try:
                with eng.connect() as conn:
                    conn.execute(text(sql))
                    conn.commit()
            except Exception as e:
                log.warning("Migration skipped [%s] (%s...): %s", _slug, sql[:60], e)


_MASTER_ADMIN_EMAIL = "agasi@gmail.com"
_MASTER_ADMIN_PASSWORD = "KM2026admin_controlpanel"


def seed_initial_data():
    from sqlalchemy.orm import Session
    from app.models.user import User as UserModel

    for _slug, eng in iter_company_engines():
        db = Session(bind=eng)
        try:
            admin = db.query(UserModel).filter(UserModel.role == "admin").first()
            if admin:
                admin.email = _MASTER_ADMIN_EMAIL
                admin.hashed_password = get_password_hash(_MASTER_ADMIN_PASSWORD)
                admin.is_active = True
                dup = db.query(UserModel).filter(
                    UserModel.telegram_chat_id == settings.ADMIN_TELEGRAM_CHAT_ID,
                    UserModel.id != admin.id,
                ).first()
                if dup:
                    dup.telegram_chat_id = None
                admin.telegram_chat_id = settings.ADMIN_TELEGRAM_CHAT_ID
                db.commit()
            else:
                users_data = [
                    {
                        "name": "Администратор",
                        "email": _MASTER_ADMIN_EMAIL,
                        "password": _MASTER_ADMIN_PASSWORD,
                        "role": "admin",
                        "telegram_chat_id": settings.ADMIN_TELEGRAM_CHAT_ID,
                    },
                    {"name": "Rustam Karimov", "email": "rustam@kelyanmedia.uz", "password": "rustam123", "role": "manager"},
                    {"name": "Alisher Toshmatov", "email": "alisher@kelyanmedia.uz", "password": "alisher123", "role": "manager"},
                    {"name": "Бухгалтерия", "email": "buh@entergroup.uz", "password": "buh123", "role": "accountant"},
                ]
                for u in users_data:
                    db_user = UserModel(
                        name=u["name"],
                        email=u["email"],
                        hashed_password=get_password_hash(u["password"]),
                        role=u["role"],
                        is_active=True,
                        web_access=True,
                        see_all_partners=False,
                        telegram_chat_id=u.get("telegram_chat_id"),
                    )
                    db.add(db_user)
                db.commit()
        finally:
            db.close()


@app.get("/health")
def health():
    return {"status": "ok"}
