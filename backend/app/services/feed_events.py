"""События ленты: новые проекты, компании, сотрудники.

ВАЖНО: каждая emit-функция открывает СОБСТВЕННУЮ сессию БД и закрывает её
в finally.  Это гарантирует, что любой сбой при записи события (таблица не
готова, FK, сетевая ошибка) НЕ переводит основную сессию API-запроса в
состояние PendingRollbackError, что иначе давало бы HTTP 500.
"""
from typing import List, Optional, Set

from sqlalchemy.orm import Session

from app.core.access import accessible_partner_ids
from app.models.feed_notification import FeedNotification
from app.models.partner import Partner
from app.models.payment import Payment
from app.models.user import User


def _truncate(text: str, limit: int = 400) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def emit_payment_created(payment_id: int, partner_id: int, description: str) -> None:
    """Записывает событие о новом проекте в собственной сессии."""
    from app.db.database import SessionLocal
    db = SessionLocal()
    try:
        partner = db.query(Partner).filter(Partner.id == partner_id).first()
        pname = partner.name if partner else "—"
        subtitle = _truncate(f"{description} · {pname}")
        db.add(FeedNotification(
            kind="payment_created",
            title="Новый проект",
            subtitle=subtitle,
            entity_type="payment",
            entity_id=payment_id,
            partner_id=partner_id,
        ))
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def emit_partner_created(partner_id: int, name: str) -> None:
    """Записывает событие о новой компании в собственной сессии."""
    from app.db.database import SessionLocal
    db = SessionLocal()
    try:
        db.add(FeedNotification(
            kind="partner_created",
            title="Новая компания",
            subtitle=_truncate(name),
            entity_type="partner",
            entity_id=partner_id,
            partner_id=partner_id,
        ))
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def emit_user_created(user_id: int, name: str, email: str) -> None:
    """Записывает событие о новом сотруднике в собственной сессии."""
    from app.db.database import SessionLocal
    db = SessionLocal()
    try:
        db.add(FeedNotification(
            kind="user_created",
            title="Новый сотрудник",
            subtitle=_truncate(f"{name} · {email}"),
            entity_type="user",
            entity_id=user_id,
            partner_id=None,
        ))
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


# ── Фильтрация видимости событий ──────────────────────────────────────────────

def _visible_for_user(n: FeedNotification, user: User, db: Session) -> bool:
    if user.feed_cleared_at and n.created_at and n.created_at <= user.feed_cleared_at:
        return False
    if n.kind == "user_created":
        return user.role == "admin"
    if n.partner_id is None:
        return False
    allowed: Optional[Set[int]] = accessible_partner_ids(db, user)
    if allowed is None:
        return True
    return n.partner_id in allowed


def list_visible_ids(db: Session, user: User, limit: int = 400) -> List[FeedNotification]:
    rows = db.query(FeedNotification).order_by(FeedNotification.created_at.desc()).limit(limit).all()
    return [n for n in rows if _visible_for_user(n, user, db)]
