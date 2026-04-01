from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, case
from typing import List, Optional
from app.db.database import get_db
from app.models.partner import Partner
from app.models.payment import Payment
from app.schemas.schemas import PartnerOut, PartnerCreate, PartnerUpdate
from app.core.security import get_current_user, require_manager_or_admin
from app.core.access import assert_partner_access, filter_partners_query, assert_manager_assignable_by_administration

router = APIRouter(prefix="/api/partners", tags=["partners"])


def enrich_partner(partner: Partner, db: Session) -> PartnerOut:
    out = PartnerOut.model_validate(partner)
    counts = db.query(
        func.count(Payment.id).label("total"),
        func.sum(case((Payment.status == "overdue", 1), else_=0)).label("overdue")
    ).filter(Payment.partner_id == partner.id, Payment.is_archived == False).first()
    out.open_payments_count = counts.total or 0
    out.overdue_count = int(counts.overdue or 0)
    return out


@router.get("", response_model=List[PartnerOut])
def list_partners(
    status: Optional[str] = None,
    partner_type: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    q = db.query(Partner).options(joinedload(Partner.manager)).filter(Partner.is_deleted == False)
    q = filter_partners_query(q, db, current_user)
    if status:
        q = q.filter(Partner.status == status)
    if partner_type:
        q = q.filter(Partner.partner_type == partner_type)
    if search:
        q = q.filter(Partner.name.ilike(f"%{search}%"))
    partners = q.order_by(Partner.name).all()
    return [enrich_partner(p, db) for p in partners]


@router.get("/{partner_id}", response_model=PartnerOut)
def get_partner(partner_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    partner = db.query(Partner).options(joinedload(Partner.manager)).filter(
        Partner.id == partner_id, Partner.is_deleted == False
    ).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")
    assert_partner_access(db, current_user, partner_id)
    return enrich_partner(partner, db)


@router.post("", response_model=PartnerOut)
def create_partner(data: PartnerCreate, db: Session = Depends(get_db), current_user=Depends(require_manager_or_admin)):
    payload = data.model_dump()
    if current_user.role == "manager":
        payload["manager_id"] = current_user.id
    if current_user.role == "administration":
        assert_manager_assignable_by_administration(db, current_user, payload.get("manager_id"))
    partner = Partner(**payload)
    db.add(partner)
    db.commit()
    db.refresh(partner)
    from app.services.feed_events import emit_partner_created
    emit_partner_created(partner.id, partner.name)
    return enrich_partner(partner, db)


@router.put("/{partner_id}", response_model=PartnerOut)
def update_partner(
    partner_id: int,
    data: PartnerUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_manager_or_admin),
):
    partner = db.query(Partner).filter(Partner.id == partner_id, Partner.is_deleted == False).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")
    assert_partner_access(db, current_user, partner_id)
    updates = data.model_dump(exclude_unset=True)
    if current_user.role == "manager" and not getattr(current_user, "see_all_partners", False):
        updates.pop("manager_id", None)
    for field, value in updates.items():
        setattr(partner, field, value)
    if current_user.role == "manager" and not getattr(current_user, "see_all_partners", False):
        partner.manager_id = current_user.id
    if current_user.role == "administration":
        assert_manager_assignable_by_administration(db, current_user, partner.manager_id)
    db.commit()
    db.refresh(partner)
    return enrich_partner(partner, db)


@router.delete("/{partner_id}")
def delete_partner(partner_id: int, db: Session = Depends(get_db), current_user=Depends(require_manager_or_admin)):
    partner = db.query(Partner).filter(Partner.id == partner_id).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")
    assert_partner_access(db, current_user, partner_id)
    partner.is_deleted = True
    db.commit()
    return {"ok": True}
