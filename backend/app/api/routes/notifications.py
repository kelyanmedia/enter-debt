from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload
from typing import List
from app.db.database import get_db
from app.models.payment import NotificationLog
from app.schemas.schemas import NotificationLogOut
from app.core.security import get_current_user
from app.core.access import accessible_partner_ids
from app.models.user import User

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("", response_model=List[NotificationLogOut])
def list_notifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    allowed = accessible_partner_ids(db, current_user)
    logs = db.query(NotificationLog).options(
        joinedload(NotificationLog.payment)
    ).order_by(NotificationLog.sent_at.desc()).limit(200).all()
    out = []
    for log in logs:
        if not log.payment:
            continue
        pid = log.payment.partner_id
        if allowed is not None and pid not in allowed:
            continue
        out.append(log)
        if len(out) >= 100:
            break
    return out
