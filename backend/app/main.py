import logging
from typing import List, Optional

from apscheduler.schedulers.background import BackgroundScheduler
from zoneinfo import ZoneInfo
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from starlette.responses import JSONResponse

from app.core.companies import COMPANY_SLUG_ORDER, normalize_company_slug
from sqlalchemy import func
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.orm import Session

from app.db.database import (
    Base,
    get_db,
    get_engine_for_slug,
    iter_company_engines,
    iter_company_sessionmakers,
    iter_registered_company_slugs,
    is_registered_company_slug,
    log_company_database_binding,
    reset_company_context,
    set_company_context,
)
from app.models import user, partner, payment
import app.models.telegram_join  # noqa: F401 — таблица telegram_join_requests
import app.models.feed_notification  # noqa: F401 — лента событий
import app.models.ceo_metric_override  # noqa: F401 — ручные значения CEO dashboard
from app.api.routes import auth, users, partners, payments, dashboard, notifications, archive, payment_months, telegram_join, feed_notifications, contract_requests, employee_tasks, employee_payment_records, finance_projects_cost, finance_cash_flow, trash
from app.api.routes import commissions, subscription_items, access_entries, company_ui
import app.models.commission  # noqa: F401
import app.models.employee_task  # noqa: F401
import app.models.subscription_item  # noqa: F401
import app.models.employee_payment_record  # noqa: F401
import app.models.access_entry  # noqa: F401
import app.models.cash_flow  # noqa: F401 — ДДС
import app.models.company_ui  # noqa: F401 — подписи разделов/линий по компании
import app.models.ceo_dashboard_block  # noqa: F401 — блоки CEO Dashboard по компании
import app.models.pl_manual_line  # noqa: F401 — ручные строки P&L по компании
import app.models.available_funds_manual  # noqa: F401
from app.core.config import settings
from app.core.security import get_current_user, get_password_hash, normalize_email
from app.models.user import User
from app.schemas.schemas import Token, UserOut
from app.api.routes.auth import CompanyOut, LoginRequest, compute_companies_list, perform_json_login

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


def _subscription_reminders_job():
    from datetime import datetime, timezone

    from app.services.subscription_reminders import run_subscription_reminders

    for slug, Session in iter_company_sessionmakers():
        db = Session()
        tok = set_company_context(slug)
        try:
            r = run_subscription_reminders(db, datetime.now(timezone.utc))
            log.info("Subscription reminders [%s]: %s", slug, r)
        except Exception:
            log.exception("Subscription reminders failed [%s]", slug)
        finally:
            db.close()
            reset_company_context(tok)


def _employee_task_reminders_job():
    from datetime import datetime, timezone

    from app.services.employee_tasks_telegram_reminders import run_employee_task_check_reminders

    for slug, Session in iter_company_sessionmakers():
        db = Session()
        tok = set_company_context(slug)
        try:
            r = run_employee_task_check_reminders(db, datetime.now(timezone.utc))
            log.info("Employee task TG reminders [%s]: %s", slug, r)
        except Exception:
            log.exception("Employee task TG reminders failed [%s]", slug)
        finally:
            db.close()
            reset_company_context(tok)


def _trash_purge_job():
    from app.services.trash_purge import purge_expired_trash

    for slug, Session in iter_company_sessionmakers():
        db = Session()
        tok = set_company_context(slug)
        try:
            r = purge_expired_trash(db)
            log.info("Trash purge [%s]: %s", slug, r)
        except Exception:
            log.exception("Trash purge failed [%s]", slug)
        finally:
            db.close()
            reset_company_context(tok)


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
app.include_router(dashboard.router_dashboard_no_api_prefix)
app.include_router(notifications.router)
app.include_router(feed_notifications.router)
app.include_router(archive.router)
app.include_router(payment_months.router)
app.include_router(telegram_join.router)
app.include_router(contract_requests.router)
app.include_router(employee_tasks.router)
app.include_router(employee_payment_records.router)
app.include_router(finance_projects_cost.router)
app.include_router(finance_projects_cost.router_finance_no_api_prefix)
app.include_router(finance_cash_flow.router)
app.include_router(commissions.router)
app.include_router(subscription_items.router)
app.include_router(access_entries.router)
app.include_router(company_ui.router)
app.include_router(trash.router)


# Если nginx проксирует с location /api/ { proxy_pass http://backend/; }, на API приходит путь без префикса /api
@app.post("/auth/login", response_model=Token, tags=["auth"], include_in_schema=False)
def _auth_login_no_api_prefix(data: LoginRequest, db: Session = Depends(get_db)):
    return perform_json_login(data, db)


@app.get("/auth/companies", response_model=List[CompanyOut], tags=["auth"], include_in_schema=False)
def _auth_companies_no_api_prefix():
    return compute_companies_list()


@app.get("/auth/me", response_model=UserOut, tags=["auth"], include_in_schema=False)
def _auth_me_no_api_prefix(current_user: User = Depends(get_current_user)):
    return current_user


@app.on_event("startup")
def startup():
    global _scheduler
    log_company_database_binding()
    for _, eng in iter_company_engines():
        Base.metadata.create_all(bind=eng)
    _migrate()
    seed_initial_data()
    _ensure_ceo_dashboard_defaults_all_companies()
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
        _scheduler.add_job(
            _subscription_reminders_job,
            "cron",
            hour=9,
            minute=0,
            id="subscription_reminders_telegram",
            replace_existing=True,
        )
        _scheduler.add_job(
            _employee_task_reminders_job,
            "cron",
            day="26,28,30",
            hour=9,
            minute=0,
            id="employee_task_reminders_telegram",
            replace_existing=True,
        )
        _scheduler.add_job(
            _trash_purge_job,
            "cron",
            hour=3,
            minute=30,
            id="trash_purge_daily",
            replace_existing=True,
        )
        _scheduler.start()
        log.info(
            "APScheduler: weekly cash report — пт 18:00; subscription reminders — ежедневно 09:00; "
            "employee task reminders — 26,28,30 в 09:00 Asia/Tashkent; trash purge — ежедневно 03:30"
        )
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
    from sqlalchemy import inspect, text
    log = logging.getLogger(__name__)
    migrations = [
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS web_access BOOLEAN DEFAULT TRUE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_subscriptions BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_accesses BOOLEAN NOT NULL DEFAULT FALSE",
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
        "ALTER TABLE employee_tasks ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE employee_tasks ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE employee_tasks ADD COLUMN IF NOT EXISTS done_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE employee_tasks ADD COLUMN IF NOT EXISTS budget_amount NUMERIC(15, 2)",
        "ALTER TABLE employee_tasks ADD COLUMN IF NOT EXISTS allocated_payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL",
        "CREATE INDEX IF NOT EXISTS ix_employee_tasks_allocated_payment_id ON employee_tasks (allocated_payment_id)",
        "ALTER TABLE employee_tasks ADD COLUMN IF NOT EXISTS cost_category VARCHAR(20)",
        "ALTER TABLE employee_payment_records ADD COLUMN IF NOT EXISTS budget_amount NUMERIC(15, 2) NOT NULL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_details_updated_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS multi_company_access BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_ad_budget_employee BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_telegram_notify_all BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_telegram_notify_manager_ids TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_accessible_company_slugs TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS can_enter_cash_flow BOOLEAN NOT NULL DEFAULT FALSE",
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
        "ALTER TABLE commissions ADD COLUMN IF NOT EXISTS payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL",
        "CREATE INDEX IF NOT EXISTS ix_commissions_payment_id ON commissions (payment_id)",
        "ALTER TABLE commissions ADD COLUMN IF NOT EXISTS received_amount_1_on DATE",
        "ALTER TABLE commissions ADD COLUMN IF NOT EXISTS received_amount_2_on DATE",
        "ALTER TABLE partners ADD COLUMN IF NOT EXISTS cooperation_start_date DATE",
        "ALTER TABLE partners ADD COLUMN IF NOT EXISTS client_joined_date DATE",
        "UPDATE partners SET partner_type = 'A' WHERE partner_type IN ('regular', 'recurring')",
        "UPDATE partners SET partner_type = 'B' WHERE partner_type = 'one_time'",
        "UPDATE partners SET partner_type = 'C' WHERE partner_type = 'service'",
        """CREATE TABLE IF NOT EXISTS subscription_items (
            id SERIAL PRIMARY KEY,
            category VARCHAR(20) NOT NULL,
            name VARCHAR(300) NOT NULL,
            vendor VARCHAR(300),
            amount NUMERIC(15,2),
            currency VARCHAR(3) NOT NULL DEFAULT 'USD',
            billing_note VARCHAR(200),
            next_due_date DATE,
            notes TEXT,
            link_url VARCHAR(800),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE
        )""",
        "CREATE INDEX IF NOT EXISTS ix_subscription_items_category ON subscription_items (category)",
        "ALTER TABLE subscription_items ADD COLUMN IF NOT EXISTS phone_number VARCHAR(32)",
        "ALTER TABLE subscription_items ADD COLUMN IF NOT EXISTS next_deadline_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE subscription_items ADD COLUMN IF NOT EXISTS recurrence VARCHAR(10) NOT NULL DEFAULT 'once'",
        "ALTER TABLE subscription_items ADD COLUMN IF NOT EXISTS reminder_days_before SMALLINT NOT NULL DEFAULT 0",
        "ALTER TABLE subscription_items ADD COLUMN IF NOT EXISTS reminder_sent_for_deadline_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE subscription_items ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active'",
        "ALTER TABLE subscription_items ADD COLUMN IF NOT EXISTS tag VARCHAR(320)",
        "ALTER TABLE subscription_items ADD COLUMN IF NOT EXISTS payer_code VARCHAR(8)",
        "ALTER TABLE subscription_items ADD COLUMN IF NOT EXISTS payment_method VARCHAR(200)",
        """CREATE TABLE IF NOT EXISTS employee_payment_records (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            paid_on DATE NOT NULL,
            period_year INTEGER,
            period_month INTEGER,
            amount NUMERIC(15,2) NOT NULL,
            currency VARCHAR(3) NOT NULL DEFAULT 'USD',
            note TEXT,
            receipt_path VARCHAR(500),
            created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_employee_payment_records_user_id ON employee_payment_records (user_id)",
        """CREATE TABLE IF NOT EXISTS access_entries (
            id SERIAL PRIMARY KEY,
            employee_name VARCHAR(160) NOT NULL,
            category VARCHAR(24) NOT NULL,
            title VARCHAR(220) NOT NULL,
            login VARCHAR(320),
            password TEXT,
            phone_number VARCHAR(40),
            twofa_code VARCHAR(120),
            reserve_email VARCHAR(220),
            device_model VARCHAR(220),
            serial_number VARCHAR(220),
            charge_cycles SMALLINT,
            photo_url VARCHAR(900),
            notes TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE
        )""",
        "CREATE INDEX IF NOT EXISTS ix_access_entries_employee_name ON access_entries (employee_name)",
        "CREATE INDEX IF NOT EXISTS ix_access_entries_category ON access_entries (category)",
        "ALTER TABLE access_entries ADD COLUMN IF NOT EXISTS service_type VARCHAR(120)",
        "ALTER TABLE access_entries ADD COLUMN IF NOT EXISTS shared_with_administration BOOLEAN NOT NULL DEFAULT FALSE",
        """CREATE TABLE IF NOT EXISTS cash_flow_template_lines (
            id SERIAL PRIMARY KEY,
            template_group VARCHAR(40) NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            label VARCHAR(200) NOT NULL,
            default_amount_uzs NUMERIC(15,2) NOT NULL DEFAULT 0,
            default_amount_usd NUMERIC(15,2) NOT NULL DEFAULT 0,
            flow_category VARCHAR(64) NOT NULL,
            payment_method VARCHAR(20) NOT NULL DEFAULT 'transfer',
            direction VARCHAR(10) NOT NULL DEFAULT 'expense'
        )""",
        "CREATE INDEX IF NOT EXISTS ix_cash_flow_tpl_group ON cash_flow_template_lines (template_group)",
        """CREATE TABLE IF NOT EXISTS cash_flow_entries (
            id SERIAL PRIMARY KEY,
            period_month VARCHAR(7) NOT NULL,
            direction VARCHAR(10) NOT NULL,
            label VARCHAR(300) NOT NULL,
            amount_uzs NUMERIC(15,2) NOT NULL DEFAULT 0,
            amount_usd NUMERIC(15,2) NOT NULL DEFAULT 0,
            apply_fx_to_uzs BOOLEAN NOT NULL DEFAULT FALSE,
            payment_method VARCHAR(20) NOT NULL DEFAULT 'transfer',
            flow_category VARCHAR(64),
            recipient VARCHAR(120),
            payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
            notes VARCHAR(500),
            template_line_id INTEGER REFERENCES cash_flow_template_lines(id) ON DELETE SET NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_cash_flow_entries_period ON cash_flow_entries (period_month)",
        "ALTER TABLE cash_flow_entries ADD COLUMN IF NOT EXISTS entry_date DATE",
        "ALTER TABLE payments ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE partners ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMP WITH TIME ZONE",
        "CREATE INDEX IF NOT EXISTS ix_payments_trashed_at ON payments (trashed_at) WHERE trashed_at IS NOT NULL",
        "CREATE INDEX IF NOT EXISTS ix_partners_trashed_at ON partners (trashed_at) WHERE trashed_at IS NOT NULL",
        "ALTER TABLE payment_months ADD COLUMN IF NOT EXISTS received_payment_method VARCHAR(20)",
        "ALTER TABLE payments ADD COLUMN IF NOT EXISTS received_payment_method VARCHAR(20)",
        "ALTER TABLE payments ADD COLUMN IF NOT EXISTS projects_cost_prime_uzs NUMERIC(15,2)",
        "ALTER TABLE payments ADD COLUMN IF NOT EXISTS projects_cost_design_uzs NUMERIC(15,2) NOT NULL DEFAULT 0",
        "ALTER TABLE payments ADD COLUMN IF NOT EXISTS projects_cost_dev_uzs NUMERIC(15,2) NOT NULL DEFAULT 0",
        "ALTER TABLE payments ADD COLUMN IF NOT EXISTS projects_cost_other_uzs NUMERIC(15,2) NOT NULL DEFAULT 0",
        "ALTER TABLE payments ADD COLUMN IF NOT EXISTS projects_cost_seo_uzs NUMERIC(15,2) NOT NULL DEFAULT 0",
        "UPDATE payments SET projects_cost_other_uzs = COALESCE(projects_cost_other_uzs, 0) + COALESCE(projects_cost_prime_uzs, 0) WHERE projects_cost_prime_uzs IS NOT NULL",
        "UPDATE payments SET projects_cost_prime_uzs = NULL",
        """CREATE TABLE IF NOT EXISTS available_funds_manual (
            period_month VARCHAR(7) PRIMARY KEY,
            deposits_uzs NUMERIC(15,2) NOT NULL DEFAULT 0
        )""",
        "ALTER TABLE available_funds_manual ADD COLUMN IF NOT EXISTS adjust_account_uzs NUMERIC(15,2) NOT NULL DEFAULT 0",
        "ALTER TABLE available_funds_manual ADD COLUMN IF NOT EXISTS adjust_cards_uzs NUMERIC(15,2) NOT NULL DEFAULT 0",
        "ALTER TABLE available_funds_manual ADD COLUMN IF NOT EXISTS usd_to_uzs_rate NUMERIC(15,4) NOT NULL DEFAULT 0",
        "ALTER TABLE payments ADD COLUMN IF NOT EXISTS billing_variant VARCHAR(40)",
        "ALTER TABLE payments ADD COLUMN IF NOT EXISTS billing_notes TEXT",
        "ALTER TABLE payments ADD COLUMN IF NOT EXISTS hosting_contact_name VARCHAR(200)",
        "ALTER TABLE payments ADD COLUMN IF NOT EXISTS hosting_payment_kind VARCHAR(120)",
        "ALTER TABLE payments ADD COLUMN IF NOT EXISTS hosting_renewal_anchor DATE",
        "ALTER TABLE payments ADD COLUMN IF NOT EXISTS hosting_prepaid_years INTEGER NOT NULL DEFAULT 0",
        """UPDATE payments SET hosting_renewal_anchor = deadline_date, hosting_prepaid_years = 0
           WHERE project_category = 'hosting_domain' AND hosting_renewal_anchor IS NULL AND deadline_date IS NOT NULL""",
        # ── Multi-tenant: одна БД, колонка company_slug ─────────────────────────
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS company_slug VARCHAR(32) NOT NULL DEFAULT 'kelyanmedia'",
        "ALTER TABLE partners ADD COLUMN IF NOT EXISTS company_slug VARCHAR(32) NOT NULL DEFAULT 'kelyanmedia'",
        "ALTER TABLE payments ADD COLUMN IF NOT EXISTS company_slug VARCHAR(32) NOT NULL DEFAULT 'kelyanmedia'",
        "UPDATE payments p SET company_slug = pr.company_slug FROM partners pr WHERE p.partner_id = pr.id",
        "ALTER TABLE commissions ADD COLUMN IF NOT EXISTS company_slug VARCHAR(32) NOT NULL DEFAULT 'kelyanmedia'",
        "UPDATE commissions c SET company_slug = u.company_slug FROM users u WHERE c.manager_id = u.id",
        "ALTER TABLE employee_tasks ADD COLUMN IF NOT EXISTS company_slug VARCHAR(32) NOT NULL DEFAULT 'kelyanmedia'",
        "UPDATE employee_tasks t SET company_slug = u.company_slug FROM users u WHERE t.user_id = u.id",
        "ALTER TABLE employee_payment_records ADD COLUMN IF NOT EXISTS company_slug VARCHAR(32) NOT NULL DEFAULT 'kelyanmedia'",
        "UPDATE employee_payment_records r SET company_slug = u.company_slug FROM users u WHERE r.user_id = u.id",
        "ALTER TABLE cash_flow_template_lines ADD COLUMN IF NOT EXISTS company_slug VARCHAR(32) NOT NULL DEFAULT 'kelyanmedia'",
        "ALTER TABLE cash_flow_entries ADD COLUMN IF NOT EXISTS company_slug VARCHAR(32) NOT NULL DEFAULT 'kelyanmedia'",
        "ALTER TABLE ceo_metric_overrides ADD COLUMN IF NOT EXISTS company_slug VARCHAR(32) NOT NULL DEFAULT 'kelyanmedia'",
        "ALTER TABLE feed_notifications ADD COLUMN IF NOT EXISTS company_slug VARCHAR(32) NOT NULL DEFAULT 'kelyanmedia'",
        "ALTER TABLE telegram_join_requests ADD COLUMN IF NOT EXISTS company_slug VARCHAR(32) NOT NULL DEFAULT 'kelyanmedia'",
        "ALTER TABLE subscription_items ADD COLUMN IF NOT EXISTS company_slug VARCHAR(32) NOT NULL DEFAULT 'kelyanmedia'",
        "ALTER TABLE access_entries ADD COLUMN IF NOT EXISTS company_slug VARCHAR(32) NOT NULL DEFAULT 'kelyanmedia'",
        "ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS company_slug VARCHAR(32) NOT NULL DEFAULT 'kelyanmedia'",
        "UPDATE notification_logs n SET company_slug = p.company_slug FROM payments p WHERE n.payment_id = p.id",
        "ALTER TABLE available_funds_manual ADD COLUMN IF NOT EXISTS company_slug VARCHAR(32) NOT NULL DEFAULT 'kelyanmedia'",
        "ALTER TABLE available_funds_manual DROP CONSTRAINT IF EXISTS available_funds_manual_pkey",
        "ALTER TABLE available_funds_manual ADD PRIMARY KEY (company_slug, period_month)",
        "ALTER TABLE ceo_metric_overrides DROP CONSTRAINT IF EXISTS uq_ceo_metric_year",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_ceo_metric_company_metric_year ON ceo_metric_overrides (company_slug, metric, year)",
        "ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key",
        "DROP INDEX IF EXISTS ix_users_email",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_company ON users (lower(email::text), company_slug)",
        "DROP INDEX IF EXISTS uq_telegram_join_chat",
        "ALTER TABLE telegram_join_requests DROP CONSTRAINT IF EXISTS telegram_join_requests_telegram_chat_id_key",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_join_company_chat ON telegram_join_requests (company_slug, telegram_chat_id)",
        """CREATE TABLE IF NOT EXISTS company_payments_segments (
            id SERIAL PRIMARY KEY,
            company_slug VARCHAR(32) NOT NULL,
            segment_key VARCHAR(32) NOT NULL,
            label VARCHAR(120) NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            is_visible BOOLEAN NOT NULL DEFAULT TRUE
        )""",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_company_payments_segment ON company_payments_segments (company_slug, segment_key)",
        "CREATE INDEX IF NOT EXISTS ix_company_payments_segments_slug ON company_payments_segments (company_slug)",
        """CREATE TABLE IF NOT EXISTS company_project_lines (
            id SERIAL PRIMARY KEY,
            company_slug VARCHAR(32) NOT NULL,
            category_slug VARCHAR(32) NOT NULL,
            label VARCHAR(120) NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            is_visible BOOLEAN NOT NULL DEFAULT TRUE
        )""",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_company_project_line ON company_project_lines (company_slug, category_slug)",
        "CREATE INDEX IF NOT EXISTS ix_company_project_lines_slug ON company_project_lines (company_slug)",
        """CREATE TABLE IF NOT EXISTS ceo_dashboard_blocks (
            id SERIAL PRIMARY KEY,
            company_slug VARCHAR(32) NOT NULL,
            kind VARCHAR(32) NOT NULL,
            pl_row_id VARCHAR(80),
            title VARCHAR(200),
            sort_order INTEGER NOT NULL DEFAULT 0
        )""",
        "CREATE INDEX IF NOT EXISTS ix_ceo_dashboard_blocks_company ON ceo_dashboard_blocks (company_slug)",
        """CREATE TABLE IF NOT EXISTS pl_manual_lines (
            id SERIAL PRIMARY KEY,
            company_slug VARCHAR(32) NOT NULL,
            section VARCHAR(32) NOT NULL,
            label VARCHAR(200) NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            link_to_net_profit BOOLEAN NOT NULL DEFAULT FALSE
        )""",
        "CREATE INDEX IF NOT EXISTS ix_pl_manual_lines_company ON pl_manual_lines (company_slug)",
        """CREATE TABLE IF NOT EXISTS pl_manual_month_cells (
            id SERIAL PRIMARY KEY,
            line_id INTEGER NOT NULL REFERENCES pl_manual_lines(id) ON DELETE CASCADE,
            period_month VARCHAR(7) NOT NULL,
            amount_uzs NUMERIC(15,2) NOT NULL DEFAULT 0,
            amount_usd NUMERIC(15,2) NOT NULL DEFAULT 0
        )""",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_pl_manual_cell_line_month ON pl_manual_month_cells (line_id, period_month)",
        "CREATE INDEX IF NOT EXISTS ix_pl_manual_month_cells_line ON pl_manual_month_cells (line_id)",
    ]
    for sql in migrations:
        # Защита от случайного удаления данных (разрешены DROP CONSTRAINT / DROP INDEX для миграций схемы)
        su = sql.upper()
        safe_schema = "DROP CONSTRAINT" in su or "DROP INDEX" in su
        forbidden = ("DELETE FROM" in su) or (
            not safe_schema and any(kw in su for kw in ("DROP", "TRUNCATE", "ALTER TABLE USERS SET"))
        )
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

    # SQLite не умеет ALTER TABLE ... ADD COLUMN IF NOT EXISTS, поэтому для новой
    # ручной логики «чистой прибыли» добиваем колонку отдельно через inspector.
    for _slug, eng in iter_company_engines():
        try:
            cols = {c["name"] for c in inspect(eng).get_columns("pl_manual_lines")}
        except Exception:
            continue
        if "link_to_net_profit" in cols:
            continue
        try:
            with eng.connect() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE pl_manual_lines "
                        "ADD COLUMN link_to_net_profit BOOLEAN NOT NULL DEFAULT FALSE"
                    )
                )
                conn.commit()
        except Exception as e:
            log.warning(
                "Migration skipped [%s] (pl_manual_lines.link_to_net_profit): %s",
                _slug,
                e,
            )

    # Такой же добор для ДДС: старые строки не должны внезапно начать конвертироваться
    # по курсу, поэтому по умолчанию флаг автоконвертации = FALSE.
    for _slug, eng in iter_company_engines():
        try:
            cols = {c["name"] for c in inspect(eng).get_columns("cash_flow_entries")}
        except Exception:
            continue
        if "apply_fx_to_uzs" in cols:
            continue
        try:
            with eng.connect() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE cash_flow_entries "
                        "ADD COLUMN apply_fx_to_uzs BOOLEAN NOT NULL DEFAULT FALSE"
                    )
                )
                conn.commit()
        except Exception as e:
            log.warning(
                "Migration skipped [%s] (cash_flow_entries.apply_fx_to_uzs): %s",
                _slug,
                e,
            )


_MASTER_ADMIN_EMAIL = "agasi@gmail.com"
_MASTER_ADMIN_PASSWORD = "KM2026admin_controlpanel"


def _ensure_ceo_dashboard_defaults_all_companies():
    """Для каждой зарегистрированной компании: если блоков CEO ещё нет — создать четыре стандартных графика."""
    from app.services.ceo_layout_defaults import ensure_ceo_layout_defaults

    for slug in iter_registered_company_slugs():
        eng = get_engine_for_slug(slug)
        tok = set_company_context(slug)
        db = Session(bind=eng)
        try:
            ensure_ceo_layout_defaults(db, slug)
        except Exception:
            log.exception("CEO dashboard default blocks [%s]", slug)
        finally:
            db.close()
            reset_company_context(tok)


def seed_initial_data():
    from app.models.user import User as UserModel

    email_key = normalize_email(_MASTER_ADMIN_EMAIL)
    # Глобальный UNIQUE на users.telegram_chat_id: один chat_id — только у одной строки в БД.
    primary_slug = COMPANY_SLUG_ORDER[0]

    for slug in iter_registered_company_slugs():
        eng = get_engine_for_slug(slug)
        tok = set_company_context(slug)
        db = Session(bind=eng)
        try:
            from app.services.cash_flow_seed import seed_cash_flow_templates
            from app.services.pl_manual_defaults import ensure_pl_manual_defaults

            seed_cash_flow_templates(db)
            ensure_pl_manual_defaults(db, slug)

            def _assign_admin_telegram(target: UserModel) -> None:
                if not settings.ADMIN_TELEGRAM_CHAT_ID:
                    return
                if slug != primary_slug:
                    return
                dup = (
                    db.query(UserModel)
                    .filter(
                        UserModel.telegram_chat_id == settings.ADMIN_TELEGRAM_CHAT_ID,
                        UserModel.id != target.id,
                    )
                    .first()
                )
                if dup:
                    dup.telegram_chat_id = None
                target.telegram_chat_id = settings.ADMIN_TELEGRAM_CHAT_ID

            master = (
                db.query(UserModel)
                .filter(
                    func.lower(UserModel.email) == email_key,
                    UserModel.company_slug == slug,
                )
                .first()
            )
            if master:
                # Прод/стейдж: не перетираем существующего пользователя при каждом рестарте API.
                # Иначе деплой неожиданно сбрасывает пароль/роль и меняет данные в боевой БД.
                pass
            elif db.query(UserModel).filter(UserModel.company_slug == slug).first() is None:
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
                    tid = u.get("telegram_chat_id")
                    if tid is not None and slug != primary_slug:
                        tid = None
                    db_user = UserModel(
                        company_slug=slug,
                        name=u["name"],
                        email=normalize_email(u["email"]),
                        hashed_password=get_password_hash(u["password"]),
                        role=u["role"],
                        is_active=True,
                        web_access=True,
                        see_all_partners=False,
                        telegram_chat_id=tid,
                    )
                    db.add(db_user)
                db.commit()
            else:
                # В существующей БД не создаём новых seed-пользователей автоматически:
                # деплой не должен менять пользователей/доступы без явной команды.
                pass
        except (OperationalError, ProgrammingError) as e:
            db.rollback()
            log.warning(
                "Сид для company_slug=%s пропущен: схема БД не совпадает с текущим кодом (%s). "
                "Для локального SQLite удалите backend/data_*.db и перезапустите uvicorn, либо подключите PostgreSQL по README.",
                slug,
                e,
            )
        finally:
            db.close()
            reset_company_context(tok)


@app.get("/health")
def health():
    return {"status": "ok"}
