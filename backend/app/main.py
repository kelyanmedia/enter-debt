from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.db.database import init_db, engine, Base
from app.models import user, partner, payment
import app.models.telegram_join  # noqa: F401 — таблица telegram_join_requests
from app.api.routes import auth, users, partners, payments, dashboard, notifications, archive, payment_months, telegram_join
from app.core.config import settings
from app.core.security import get_password_hash

app = FastAPI(title="EnterDebt API", version="1.0.0", redirect_slashes=False)

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
app.include_router(archive.router)
app.include_router(payment_months.router)
app.include_router(telegram_join.router)


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    _migrate()
    seed_initial_data()


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
    ]
    for sql in migrations:
        try:
            with engine.connect() as conn:
                conn.execute(text(sql))
                conn.commit()
        except Exception as e:
            log.warning(f"Migration skipped ({sql[:60]}...): {e}")


_MASTER_ADMIN_EMAIL = "agasi@gmail.com"
_MASTER_ADMIN_PASSWORD = "KM2026admin_controlpanel"


def seed_initial_data():
    from sqlalchemy.orm import Session
    from app.models.user import User as UserModel

    db = Session(bind=engine)
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
