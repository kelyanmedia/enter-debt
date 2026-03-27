"""События ленты: новые проекты, компании, сотрудники."""
from typing import List, Optional, Set

from sqlalchemy.orm import Session

from app.core.access import accessible_partner_ids
from app.models.feed_notification import FeedNotification
from app.models.partner import Partner
from app.models.payment import Payment
from app.models.user import User


def emit_payment_created(db: Session, payment: Payment) -> None:
    partner = db.query(Partner).filter(Partner.id == payment.partner_id).first()
    pname = partner.name if partner else "—"
    n = FeedNotification(
        kind="payment_created",
        title="Новый проект",
        subtitle=f"{payment.description} · {pname}",
        entity_type="payment",
        entity_id=payment.id,
        partner_id=payment.partner_id,
    )
    db.add(n)
    db.commit()


def emit_partner_created(db: Session, partner: Partner) -> None:
    n = FeedNotification(
        kind="partner_created",
        title="Новая компания",
        subtitle=partner.name,
        entity_type="partner",
        entity_id=partner.id,
        partner_id=partner.id,
    )
    db.add(n)
    db.commit()


def emit_user_created(db: Session, user: User) -> None:
    n = FeedNotification(
        kind="user_created",
        title="Новый сотрудник",
        subtitle=f"{user.name} · {user.email}",
        entity_type="user",
        entity_id=user.id,
        partner_id=None,
    )
    db.add(n)
    db.commit()


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
