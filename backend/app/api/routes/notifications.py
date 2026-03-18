from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload
from typing import List
from app.db.database import get_db
from app.models.payment import NotificationLog
from app.schemas.schemas import NotificationLogOut
from app.core.security import get_current_user

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("", response_model=List[NotificationLogOut])
def list_notifications(
    db: Session = Depends(get_db),
    _=Depends(get_current_user)
):
    logs = db.query(NotificationLog).options(
        joinedload(NotificationLog.payment)
    ).order_by(NotificationLog.sent_at.desc()).limit(100).all()
    return logs
