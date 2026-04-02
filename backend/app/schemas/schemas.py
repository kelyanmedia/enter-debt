from pydantic import BaseModel, EmailStr, Field, BeforeValidator, field_validator
from typing import Optional, List, Literal, Dict, Any, Annotated
from datetime import datetime, date
from decimal import Decimal


def _coerce_visible_manager_ids_field(v: Any) -> List[int]:
    if v is None:
        return []
    if isinstance(v, list):
        return [int(x) for x in v]
    if isinstance(v, str):
        import json
        s = v.strip()
        if not s:
            return []
        try:
            return [int(x) for x in json.loads(s)]
        except (TypeError, ValueError, json.JSONDecodeError):
            return []
    return []


VisibleManagerIds = Annotated[List[int], BeforeValidator(_coerce_visible_manager_ids_field)]


# ── AUTH ──────────────────────────────────────────────────────────────────────
class Token(BaseModel):
    access_token: str
    token_type: str
    user: "UserOut"


class TokenData(BaseModel):
    user_id: Optional[int] = None


class ProfileSelfUpdate(BaseModel):
    """Смена своего email и/или пароля; текущий пароль обязателен."""

    current_password: str
    email: EmailStr
    new_password: Optional[str] = None
    payment_details: Optional[str] = None  # только role=employee, через exclude_unset в patch


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
    payment_details: Optional[str] = None  # реквизиты выплат для сотрудников (freelance)
    multi_company_access: bool = False  # только employee: переключение компаний в кабинете


class UserCreate(UserBase):
    password: str
    visible_manager_ids: Optional[List[int]] = None


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
    visible_manager_ids: Optional[List[int]] = None
    payment_details: Optional[str] = None
    multi_company_access: Optional[bool] = None


class AssignedPartnersBody(BaseModel):
    partner_ids: List[int]


class UserOut(UserBase):
    """Ответ API: email как str — в БД может быть любая строка, иначе EmailStr даёт 500 при сериализации."""

    id: int
    created_at: datetime
    email: str
    last_login_at: Optional[datetime] = None
    visible_manager_ids: VisibleManagerIds = Field(default_factory=list)
    payment_details_updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── EMPLOYEE TASKS (freelance / зарплата) ─────────────────────────────────────
class EmployeeTaskBase(BaseModel):
    work_date: date
    project_name: str = Field(..., max_length=300)
    task_description: str = Field(..., max_length=600)
    task_url: Optional[str] = Field(None, max_length=800)
    hours: Optional[Decimal] = None
    amount: Optional[Decimal] = None
    currency: str = Field(default="USD", max_length=3)
    status: str = Field(default="not_started", max_length=30)
    paid: bool = False


class EmployeeTaskCreate(EmployeeTaskBase):
    """Для админа в теле запроса передайте user_id — задача будет создана для этого сотрудника."""

    user_id: Optional[int] = Field(
        default=None,
        description="Только админ: ID пользователя с ролью employee",
    )


class EmployeeTaskUpdate(BaseModel):
    work_date: Optional[date] = None
    project_name: Optional[str] = Field(None, max_length=300)
    task_description: Optional[str] = Field(None, max_length=600)
    task_url: Optional[str] = Field(None, max_length=800)
    hours: Optional[Decimal] = None
    amount: Optional[Decimal] = None
    currency: Optional[str] = Field(None, max_length=3)
    status: Optional[str] = Field(None, max_length=30)
    paid: Optional[bool] = None


class EmployeeTaskOut(EmployeeTaskBase):
    id: int
    user_id: int
    created_at: datetime
    paid_at: Optional[datetime] = None
    done_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class EmployeePaymentRecordOut(BaseModel):
    """История выплат сотруднику: дата перевода, период, сумма, чек."""

    id: int
    user_id: int
    paid_on: date
    period_year: Optional[int] = None
    period_month: Optional[int] = None
    amount: Decimal
    currency: str
    note: Optional[str] = None
    has_receipt: bool
    entered_by: str  # self | admin
    created_at: datetime


class StaffEmployeeOut(BaseModel):
    id: int
    name: str
    email: str
    payment_details: Optional[str] = None
    payment_details_updated_at: Optional[datetime] = None
    task_count: int = 0


class StaffMonthTotalsOut(BaseModel):
    year: int
    month: int
    label: str
    total_usd: Decimal
    total_uzs: Decimal
    total_hours: Decimal


# ── SUBSCRIPTION ITEMS (реестр: бытовые / телефоны / сервисы) ─────────────────
SubscriptionRecurrence = Literal["once", "monthly", "yearly"]
SubscriptionStatus = Literal["active", "inactive"]
SubscriptionPayerCode = Literal["KM", "WW"]


class SubscriptionItemBase(BaseModel):
    name: str = Field(..., max_length=300)
    status: SubscriptionStatus = "active"
    tag: Optional[str] = Field(None, max_length=320)
    payer_code: Optional[SubscriptionPayerCode] = None
    payment_method: Optional[str] = Field(None, max_length=200)
    phone_number: Optional[str] = Field(None, max_length=32)
    vendor: Optional[str] = Field(None, max_length=300)
    amount: Optional[Decimal] = None
    currency: str = Field(default="USD", max_length=3)
    billing_note: Optional[str] = Field(None, max_length=200)
    next_due_date: Optional[date] = None
    next_deadline_at: Optional[datetime] = None
    recurrence: SubscriptionRecurrence = "once"
    reminder_days_before: int = Field(default=0, ge=0, le=2)
    notes: Optional[str] = None
    link_url: Optional[str] = Field(None, max_length=800)

    @field_validator("phone_number", mode="before")
    @classmethod
    def strip_phone(cls, v: Any) -> Any:
        if v is None or v == "":
            return None
        if isinstance(v, str):
            s = v.strip()
            return s or None
        return v

    @field_validator("tag", "payment_method", mode="before")
    @classmethod
    def strip_opt_text(cls, v: Any) -> Any:
        if v is None or v == "":
            return None
        if isinstance(v, str):
            s = v.strip()
            return s or None
        return v


class SubscriptionItemCreate(SubscriptionItemBase):
    category: str = Field(..., max_length=20)


class SubscriptionItemUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=300)
    status: Optional[SubscriptionStatus] = None
    tag: Optional[str] = Field(None, max_length=320)
    payer_code: Optional[SubscriptionPayerCode] = None
    payment_method: Optional[str] = Field(None, max_length=200)
    phone_number: Optional[str] = Field(None, max_length=32)
    vendor: Optional[str] = Field(None, max_length=300)
    amount: Optional[Decimal] = None
    currency: Optional[str] = Field(None, max_length=3)
    billing_note: Optional[str] = Field(None, max_length=200)
    next_due_date: Optional[date] = None
    next_deadline_at: Optional[datetime] = None
    recurrence: Optional[SubscriptionRecurrence] = None
    reminder_days_before: Optional[int] = Field(None, ge=0, le=2)
    notes: Optional[str] = None
    link_url: Optional[str] = Field(None, max_length=800)

    @field_validator("phone_number", mode="before")
    @classmethod
    def strip_phone_u(cls, v: Any) -> Any:
        if v is None:
            return None
        if v == "":
            return None
        if isinstance(v, str):
            s = v.strip()
            return s or None
        return v

    @field_validator("tag", "payment_method", mode="before")
    @classmethod
    def strip_opt_text_u(cls, v: Any) -> Any:
        if v is None:
            return None
        if v == "":
            return None
        if isinstance(v, str):
            s = v.strip()
            return s or None
        return v

    @field_validator("payer_code", mode="before")
    @classmethod
    def payer_empty_u(cls, v: Any) -> Any:
        if v == "":
            return None
        return v


class SubscriptionItemOut(SubscriptionItemBase):
    id: int
    category: str
    created_at: datetime

    class Config:
        from_attributes = True


# ── PARTNERS ──────────────────────────────────────────────────────────────────
class PartnerBase(BaseModel):
    name: str
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    partner_type: str = "A"
    manager_id: Optional[int] = None
    status: str = "active"
    comment: Optional[str] = None
    cooperation_start_date: Optional[date] = None
    client_joined_date: Optional[date] = None


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
    cooperation_start_date: Optional[date] = None
    client_joined_date: Optional[date] = None


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
    project_category: Optional[str] = None  # web | seo | ppc | mobile_app | tech_support | hosting_domain


class PaymentCreate(PaymentBase):
    pass


# ── PAYMENT MONTHS ─────────────────────────────────────────────────────────────
class PaymentMonthCreate(BaseModel):
    month: str   # YYYY-MM
    amount: Optional[Decimal] = None
    description: Optional[str] = None
    note: Optional[str] = None
    due_date: Optional[date] = None  # срок оплаты; если не задан — из day_of_month договора или конец месяца


class PaymentMonthOut(BaseModel):
    id: int
    payment_id: int
    month: str
    due_date: Optional[date] = None
    amount: Optional[Decimal] = None
    status: str
    description: Optional[str] = None
    note: Optional[str] = None
    paid_at: Optional[datetime] = None
    confirmed_by: Optional[int] = None
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
    project_category: Optional[str] = None  # web | seo | ppc | mobile_app | tech_support | hosting_domain


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
    # Если строка развёрнута из payment_months (дебиторка по месяцам)
    source_payment_month_id: Optional[int] = None
    # Период услуги / акт по строке графика (YYYY-MM), напр. «март 2026» на фронте
    service_month: Optional[str] = None
    # Ближайший неоплаченный месяц графика (для списка проектов и напоминаний)
    next_payment_due_date: Optional[date] = None
    next_payment_month: Optional[str] = None

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


class WeeklyCashReportSendOut(BaseModel):
    """Результат ручной или фоновой отправки еженедельного отчёта в Telegram."""

    ok: bool
    detail: Optional[str] = None
    period_start: Optional[str] = None
    period_end: Optional[str] = None
    total: Optional[str] = None
    row_count: int = 0
    project_groups: int = 0
    sent_to: List[int] = Field(default_factory=list)


class ReceivedPaymentRowOut(BaseModel):
    """Одна зафиксированная оплата за выбранный календарный месяц (по дате paid_at)."""

    kind: str  # month_line | project_whole
    paid_at: datetime
    amount: Decimal
    partner_id: int
    partner_name: str
    payment_id: int
    project_description: str
    service_month: Optional[str] = None
    line_description: Optional[str] = None
    confirmed_by_id: Optional[int] = None
    confirmed_by_name: Optional[str] = None


class CeoStats(BaseModel):
    total_projects: int
    web_projects: int
    seo_projects: int
    ppc_projects: int
    mobile_app_projects: int
    tech_support_projects: int
    hosting_domain_projects: int


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


# ── COMMISSIONS ───────────────────────────────────────────────────────────────
class CommissionBase(BaseModel):
    project_name: str
    project_type: str                           # site | seo | ppc
    project_cost: Decimal
    production_cost: Decimal = Decimal(0)
    manager_percent: Decimal                    # 1–20
    actual_payment: Optional[Decimal] = None
    received_amount_1: Optional[Decimal] = None
    received_amount_2: Optional[Decimal] = None
    commission_paid_full: bool = False
    project_date: date
    note: Optional[str] = None


class CommissionCreate(CommissionBase):
    manager_id: Optional[int] = None           # admin may override


class CommissionUpdate(BaseModel):
    project_name: Optional[str] = None
    project_type: Optional[str] = None
    project_cost: Optional[Decimal] = None
    production_cost: Optional[Decimal] = None
    manager_percent: Optional[Decimal] = None
    actual_payment: Optional[Decimal] = None
    received_amount_1: Optional[Decimal] = None
    received_amount_2: Optional[Decimal] = None
    commission_paid_full: Optional[bool] = None
    project_date: Optional[date] = None
    note: Optional[str] = None
    manager_id: Optional[int] = None


class CommissionOut(CommissionBase):
    id: int
    manager_id: int
    manager: Optional["UserOut"] = None
    created_at: datetime
    # Computed fields (filled in route)
    profit: Decimal = Decimal(0)
    total_manager_income: Decimal = Decimal(0)
    manager_income_from_actual: Decimal = Decimal(0)
    total_received: Decimal = Decimal(0)

    class Config:
        from_attributes = True


class CommissionStatsOut(BaseModel):
    total_projects: int
    total_cost: Decimal
    total_profit: Decimal
    total_manager_income: Decimal
    total_received: Decimal
    total_pending: Decimal


Token.model_rebuild()
PaymentOut.model_rebuild()
CommissionOut.model_rebuild()
