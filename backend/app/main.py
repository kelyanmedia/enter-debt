from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.db.database import init_db, engine, Base
from app.models import user, partner, payment
from app.api.routes import auth, users, partners, payments, dashboard, notifications, archive, payment_months
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


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    _migrate()
    seed_initial_data()


def _migrate():
    """Idempotent column additions for existing deployments."""
    from sqlalchemy import text
    with engine.connect() as conn:
        conn.execute(text(
            "ALTER TABLE payments ADD COLUMN IF NOT EXISTS contract_months INTEGER"
        ))
        conn.commit()


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
            db.commit()
        else:
            users_data = [
                {"name": "Администратор", "email": _MASTER_ADMIN_EMAIL, "password": _MASTER_ADMIN_PASSWORD, "role": "admin"},
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
                )
                db.add(db_user)
            db.commit()
    finally:
        db.close()


@app.get("/health")
def health():
    return {"status": "ok"}
