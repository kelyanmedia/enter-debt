from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.db.database import init_db, engine, Base
from app.models import user, partner, payment
from app.api.routes import auth, users, partners, payments, dashboard, notifications
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


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    seed_initial_data()


def seed_initial_data():
    from sqlalchemy.orm import Session
    from app.models.user import User as UserModel

    db = Session(bind=engine)
    try:
        if db.query(UserModel).count() == 0:
            users_data = [
                {"name": "Администратор", "email": settings.ADMIN_EMAIL, "password": settings.ADMIN_PASSWORD, "role": "admin"},
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
