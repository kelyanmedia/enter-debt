#!/usr/bin/env python3
"""
Сброс пароля пользователя по email (на сервере с .env / DATABASE_URL).

  cd /path/to/enter-debt/backend && python ../scripts/reset_user_password.py rustam@mail.ru 'новый_пароль'

Или из корня репозитория:

  DATABASE_URL=postgresql://... python scripts/reset_user_password.py rustam@mail.ru 'новый_пароль'
"""
from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND = os.path.join(ROOT, "backend")
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)
os.chdir(BACKEND)


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: python scripts/reset_user_password.py <email> <new_password>")
        sys.exit(1)
    email_raw = sys.argv[1]
    new_pw = sys.argv[2].strip()
    if len(new_pw) < 4:
        print("Пароль: минимум 4 символа")
        sys.exit(1)

    from sqlalchemy import func

    from app.core.security import get_password_hash, normalize_email
    from app.db.database import SessionLocal
    from app.models.user import User

    email_key = normalize_email(email_raw)
    db = SessionLocal()
    try:
        u = db.query(User).filter(func.lower(User.email) == email_key).first()
        if not u:
            print(f"Пользователь не найден: {email_key}")
            sys.exit(1)
        u.hashed_password = get_password_hash(new_pw)
        db.commit()
        print(f"OK: пароль обновлён для {u.email} (id={u.id}, роль={u.role})")
    finally:
        db.close()


if __name__ == "__main__":
    main()
