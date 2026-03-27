from pydantic import BaseModel, EmailStr
from typing import Optional, List, Literal, Dict, Any
from datetime import datetime, date
from decimal import Decimal


# ── AUTH ──────────────────────────────────────────────────────────────────────
class Token(BaseModel):
    access_token: str
    token_type: str
    user: "UserOut"


class TokenData(BaseModel):
    user_id: Optional[int] = None


# ── USERS ─────────────────────────────────────────────────────────────────────
class UserBase(BaseModel):
    name: str
    email: EmailStr
    role: str = "manager"
    telegram_id: Optional[str] = None
    telegram_chat_id: Optional[int] = None
    telegram_username: Optional[str] = None
    is_active: bool = True
    web_access: bool = True
    see_all_partners: bool = False


class UserCreate(UserBase):
    password: str


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    role: Optional[str] = None
    telegram_id: Optional[str] = None
    telegram_chat_id: Optional[int] = None
    telegram_username: Optional[str] = None
    is_active: Optional[bool] = None
    web_access: Optional[bool] = None
    see_all_partners: Optional[bool] = None
    password: Optional[str] = None


class AssignedPartnersBody(BaseModel):
    partner_ids: List[int]


class UserOut(UserBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


# ── PARTNERS ──────────────────────────────────────────────────────────────────
class PartnerBase(BaseModel):
    name: str
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    partner_type: str = "regular"
    manager_id: Optional[int] = None
    status: str = "active"
    comment: Optional[str] = None


class PartnerCreate(PartnerBase):
    pass


class PartnerUpdate(BaseModel):
    name: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    partner_type: Optional[str] = None
    manager_id: Optional[int] = None
    status: Optional[str] = None
    comment: Optional[str] = None


class PartnerOut(PartnerBase):
    id: int
    created_at: datetime
    manager: Optional[UserOut] = None
    open_payments_count: Optional[int] = 0
    overdue_count: Optional[int] = 0

    class Config:
        from_attributes = True


# ── PAYMENTS ──────────────────────────────────────────────────────────────────
class PaymentBase(BaseModel):
    partner_id: int
    payment_type: str
    description: str
    amount: Decimal
    contract_months: Optional[int] = None
    day_of_month: Optional[int] = None
    deadline_date: Optional[date] = None
    remind_days_before: int = 3
    notify_accounting: bool = True
    contract_url: Optional[str] = None
    service_period: Optional[str] = None  # monthly / yearly
    project_category: Optional[str] = None  # web | seo | ppc


class PaymentCreate(PaymentBase):
    pass


# ── PAYMENT MONTHS ─────────────────────────────────────────────────────────────
class PaymentMonthCreate(BaseModel):
    month: str   # YYYY-MM
    amount: Optional[Decimal] = None
    description: Optional[str] = None
    note: Optional[str] = None


class PaymentMonthOut(BaseModel):
    id: int
    payment_id: int
    month: str
    amount: Optional[Decimal] = None
    status: str
    description: Optional[str] = None
    note: Optional[str] = None
    paid_at: Optional[datetime] = None
    act_issued: bool = False
    act_issued_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class PaymentUpdate(BaseModel):
    partner_id: Optional[int] = None
    payment_type: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[Decimal] = None
    contract_months: Optional[int] = None
    day_of_month: Optional[int] = None
    deadline_date: Optional[date] = None
    remind_days_before: Optional[int] = None
    status: Optional[str] = None
    postponed_until: Optional[date] = None
    notify_accounting: Optional[bool] = None
    contract_url: Optional[str] = None
    service_period: Optional[str] = None
    project_category: Optional[str] = None


class PaymentConfirm(BaseModel):
    postpone_days: Optional[int] = 0


class PaymentOut(PaymentBase):
    id: int
    status: str
    paid_at: Optional[datetime] = None
    confirmed_by: Optional[int] = None
    postponed_until: Optional[date] = None
    last_notified_at: Optional[datetime] = None
    is_archived: bool
    notify_accounting: Optional[bool] = True
    contract_url: Optional[str] = None
    service_period: Optional[str] = None
    created_at: datetime
    partner: Optional[PartnerOut] = None
    confirmed_by_user: Optional[UserOut] = None
    days_until_due: Optional[int] = None
    months: List['PaymentMonthOut'] = []

    class Config:
        from_attributes = True


# ── DASHBOARD ─────────────────────────────────────────────────────────────────
class DashboardStats(BaseModel):
    total_receivable: Decimal
    overdue_count: int
    pending_count: int
    paid_this_month: int
    paid_amount_this_month: Decimal
    partners_count: int


class CeoStats(BaseModel):
    total_projects: int
    web_projects: int
    seo_projects: int
    ppc_projects: int


class CeoTurnoverPoint(BaseModel):
    month: str  # YYYY-MM
    label: str
    amount: Decimal
    previous_year_amount: Decimal


class CeoTurnoverOut(BaseModel):
    year: Optional[int] = None
    points: List[CeoTurnoverPoint]


class CeoLtvBucket(BaseModel):
    key: str
    label: str
    count: int


class CeoLtvOut(BaseModel):
    year: Optional[int] = None
    buckets: List[CeoLtvBucket]


class CeoClientHistoryPoint(BaseModel):
    month: str  # YYYY-MM
    label: str
    count: int


class CeoClientHistoryOut(BaseModel):
    year: int
    points: List[CeoClientHistoryPoint]


class CeoOverridePut(BaseModel):
    metric: Literal["client_history", "turnover", "ltv"]
    year: int
    data: Dict[str, Any]


# ── NOTIFICATIONS ─────────────────────────────────────────────────────────────
class FeedNotificationOut(BaseModel):
    id: int
    kind: str
    title: str
    subtitle: Optional[str] = None
    entity_type: str
    entity_id: int
    created_at: datetime
    read: bool = False

    class Config:
        from_attributes = True


class NotificationLogOut(BaseModel):
    id: int
    payment_id: int
    sent_to_chat_id: str
    sent_to_name: Optional[str]
    message_text: Optional[str]
    status: str
    sent_at: datetime
    payment: Optional[PaymentOut] = None

    class Config:
        from_attributes = True


class TelegramJoinRequestOut(BaseModel):
    id: int
    telegram_chat_id: int
    telegram_username: Optional[str] = None
    full_name: Optional[str] = None
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class TelegramJoinApprove(BaseModel):
    role: str  # manager | accountant
    name: str
    email: Optional[str] = None


class TelegramJoinInternalRequest(BaseModel):
    chat_id: int
    username: Optional[str] = None
    full_name: Optional[str] = None
    access_password: str


Token.model_rebuild()
PaymentOut.model_rebuild()
