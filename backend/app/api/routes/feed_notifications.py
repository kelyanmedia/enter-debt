from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from typing import List, Set

from app.db.database import get_db, get_request_company
from app.models.user import User
from app.models.feed_notification import FeedNotificationRead
from app.schemas.schemas import FeedNotificationOut
from app.core.security import get_current_user
from app.services.feed_events import list_visible_ids

router = APIRouter(prefix="/api/feed-notifications", tags=["feed-notifications"])


def _read_ids_for_user(db: Session, user_id: int, nids: List[int]) -> Set[int]:
    if not nids:
        return set()
    rows = (
        db.query(FeedNotificationRead.notification_id)
        .filter(FeedNotificationRead.user_id == user_id, FeedNotificationRead.notification_id.in_(nids))
        .all()
    )
    return {r[0] for r in rows}


@router.get("", response_model=List[FeedNotificationOut])
def list_feed(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    visible = list_visible_ids(db, current_user, limit=400)
    nids = [n.id for n in visible]
    read_set = _read_ids_for_user(db, current_user.id, nids)
    out: List[FeedNotificationOut] = []
    for n in visible:
        out.append(
            FeedNotificationOut(
                id=n.id,
                kind=n.kind,
                title=n.title,
                subtitle=n.subtitle,
                entity_type=n.entity_type,
                entity_id=n.entity_id,
                created_at=n.created_at,
                read=n.id in read_set,
            )
        )
    return out


@router.get("/unread-count")
def unread_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    visible = list_visible_ids(db, current_user, limit=400)
    nids = [n.id for n in visible]
    read_set = _read_ids_for_user(db, current_user.id, nids)
    return {"count": sum(1 for nid in nids if nid not in read_set)}


@router.post("/{notification_id}/read")
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    visible = {n.id for n in list_visible_ids(db, current_user, limit=400)}
    if notification_id not in visible:
        raise HTTPException(status_code=404, detail="Not found")
    exists = (
        db.query(FeedNotificationRead)
        .filter_by(notification_id=notification_id, user_id=current_user.id)
        .first()
    )
    if not exists:
        db.add(FeedNotificationRead(notification_id=notification_id, user_id=current_user.id))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
    return {"ok": True}


@router.post("/read-all")
def mark_all_read(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    visible = list_visible_ids(db, current_user, limit=400)
    nids = [n.id for n in visible]
    read_set = _read_ids_for_user(db, current_user.id, nids)
    for n in visible:
        if n.id in read_set:
            continue
        db.add(FeedNotificationRead(notification_id=n.id, user_id=current_user.id))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
    return {"ok": True}


@router.post("/clear")
def clear_feed(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from datetime import datetime, timezone

    u = (
        db.query(User)
        .filter(User.id == current_user.id, User.company_slug == get_request_company())
        .first()
    )
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    u.feed_cleared_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}
