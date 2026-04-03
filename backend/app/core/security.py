from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db.database import get_db

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")


def normalize_email(email: str) -> str:
    """Единый формат логина: без пробелов, в нижнем регистре."""
    return (email or "").strip().lower()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    if not plain_password or not hashed_password:
        return False
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except (ValueError, TypeError):
        return False


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    from app.models.user import User
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.id == int(user_id)).first()
    if user is None or not user.is_active:
        raise credentials_exception
    return user


def require_admin(current_user=Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


def require_manager_or_admin(current_user=Depends(get_current_user)):
    if current_user.role not in ("admin", "manager", "administration"):
        raise HTTPException(status_code=403, detail="Manager or admin access required")
    return current_user


def require_payment_write(current_user=Depends(get_current_user)):
    """Создание/изменение проектов (платежей): админ, менеджер, бухгалтерия, администрация."""
    if current_user.role not in ("admin", "manager", "accountant", "administration"):
        raise HTTPException(status_code=403, detail="Недостаточно прав для изменения проектов")
    return current_user


def require_admin_or_financier(current_user=Depends(get_current_user)):
    """Полный доступ к разделу «Финансы» (ДДС, оплаты и т.д.) — админ и финансист."""
    if current_user.role not in ("admin", "financier"):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    return current_user


def require_cash_flow_dds_input(current_user=Depends(get_current_user)):
    """Справочники и создание строки ДДС: админ, финансист или любая администрация (страница «Ввод ДДС»)."""
    if current_user.role in ("admin", "financier"):
        return current_user
    if current_user.role == "administration":
        return current_user
    raise HTTPException(status_code=403, detail="Доступ запрещён")


def require_admin_or_accountant(current_user=Depends(get_current_user)):
    """CEO Dashboard и агрегированная аналитика — админ, бухгалтерия, финансист; не менеджеры."""
    if current_user.role not in ("admin", "accountant", "financier"):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    return current_user
