"""CRM-lite: клиентская база и компании в проработке менеджеров."""

from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class SalesCompany(Base):
    __tablename__ = "sales_companies"

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True)
    company_name = Column(String(300), nullable=False)
    brand_name = Column(String(220), nullable=True)
    client_type = Column(String(1), nullable=True)  # A / B / C
    status = Column(String(120), nullable=True)
    comment = Column(Text, nullable=True)
    group_id = Column(Integer, ForeignKey("sales_company_groups.id", ondelete="SET NULL"), nullable=True, index=True)
    assigned_manager_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    brought_by_manager_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    brought_by_name = Column(String(220), nullable=True)
    position = Column(String(220), nullable=True)
    contact_name = Column(String(220), nullable=True)
    phone = Column(String(80), nullable=True)
    email = Column(String(220), nullable=True)
    contact_actuality_date = Column(Date, nullable=True)
    contact = Column(Text, nullable=True)
    lpr_name = Column(String(220), nullable=True)
    lpr_role = Column(String(160), nullable=True)
    lvr_name = Column(String(220), nullable=True)
    lvr_role = Column(String(160), nullable=True)
    previous_jobs = Column(Text, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    trashed_at = Column(DateTime(timezone=True), nullable=True)

    group = relationship("SalesCompanyGroup", back_populates="companies")
    assigned_manager = relationship("User", foreign_keys=[assigned_manager_id])
    brought_by_manager = relationship("User", foreign_keys=[brought_by_manager_id])
    created_by_user = relationship("User", foreign_keys=[created_by_user_id])
    interactions = relationship(
        "SalesCompanyInteraction",
        back_populates="company",
        cascade="all, delete-orphan",
    )


class SalesCompanyGroup(Base):
    __tablename__ = "sales_company_groups"

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    note = Column(Text, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    created_by_user = relationship("User")
    companies = relationship("SalesCompany", back_populates="group")


class SalesCompanyInteraction(Base):
    __tablename__ = "sales_company_interactions"

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True)
    sales_company_id = Column(Integer, ForeignKey("sales_companies.id", ondelete="CASCADE"), nullable=False, index=True)
    interaction_date = Column(Date, nullable=False)
    project_name = Column(String(300), nullable=True)
    status = Column(String(120), nullable=True)
    note = Column(Text, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    company = relationship("SalesCompany", back_populates="interactions")
    created_by_user = relationship("User")


class SalesWishlistItem(Base):
    __tablename__ = "sales_wishlist_items"

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True)
    company_name = Column(String(300), nullable=False)
    potential_entry = Column(String(300), nullable=True)
    reason = Column(Text, nullable=True)
    comment = Column(Text, nullable=True)
    offer = Column(Text, nullable=True)
    assigned_manager_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    activated_company_id = Column(Integer, ForeignKey("sales_companies.id", ondelete="SET NULL"), nullable=True, index=True)
    activated_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    assigned_manager = relationship("User", foreign_keys=[assigned_manager_id])
    created_by_user = relationship("User", foreign_keys=[created_by_user_id])
    activated_company = relationship("SalesCompany", foreign_keys=[activated_company_id])
