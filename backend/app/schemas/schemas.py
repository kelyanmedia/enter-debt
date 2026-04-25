from pydantic import BaseModel, EmailStr, Field, BeforeValidator, field_validator, model_validator
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


def _coerce_admin_company_slugs_read(v: Any) -> Optional[List[str]]:
    """Колонка TEXT с JSON-массивом slug или None = доступ ко всем организациям."""
    if v is None:
        return None
    if isinstance(v, list):
        return [str(x) for x in v]
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return None
        import json

        try:
            arr = json.loads(s)
            if isinstance(arr, list):
                return [str(x) for x in arr]
        except (TypeError, ValueError, json.JSONDecodeError):
            return None
    return None


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
    can_view_subscriptions: bool = False
    can_view_accesses: bool = False
    can_enter_cash_flow: bool = False  # только administration: ввод ДДС без отчёта
    see_all_partners: bool = False
    payment_details: Optional[str] = None  # реквизиты выплат для сотрудников (freelance)
    multi_company_access: bool = False  # только employee: переключение компаний в кабинете
    # только employee: работа с проходным рекламным бюджетом — в P&L только доля «услуга» (сумма − бюджет)
    is_ad_budget_employee: bool = False
    # только role=admin: копии Telegram (менеджер ↔ бухгалтерия)
    admin_telegram_notify_all: bool = False


class UserCreate(UserBase):
    password: str
    visible_manager_ids: Optional[List[int]] = None
    admin_telegram_notify_manager_ids: Optional[List[int]] = None
    # только admin: какие организации в переключателе; не передано — только текущая (см. create_user)
    admin_accessible_company_slugs: Optional[List[str]] = None


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    role: Optional[str] = None
    telegram_id: Optional[str] = None
    telegram_chat_id: Optional[int] = None
    telegram_username: Optional[str] = None
    is_active: Optional[bool] = None
    web_access: Optional[bool] = None
    can_view_subscriptions: Optional[bool] = None
    can_view_accesses: Optional[bool] = None
    can_enter_cash_flow: Optional[bool] = None
    see_all_partners: Optional[bool] = None
    password: Optional[str] = None
    visible_manager_ids: Optional[List[int]] = None
    payment_details: Optional[str] = None
    multi_company_access: Optional[bool] = None
    is_ad_budget_employee: Optional[bool] = None
    admin_telegram_notify_all: Optional[bool] = None
    admin_telegram_notify_manager_ids: Optional[List[int]] = None
    admin_accessible_company_slugs: Optional[List[str]] = None


class AssignedPartnersBody(BaseModel):
    partner_ids: List[int]


class UserOut(UserBase):
    """Ответ API: email как str — в БД может быть любая строка, иначе EmailStr даёт 500 при сериализации."""

    id: int
    created_at: datetime
    email: str
    last_login_at: Optional[datetime] = None
    visible_manager_ids: VisibleManagerIds = Field(default_factory=list)
    admin_telegram_notify_manager_ids: VisibleManagerIds = Field(default_factory=list)
    admin_accessible_company_slugs: Annotated[
        Optional[List[str]], BeforeValidator(_coerce_admin_company_slugs_read)
    ] = None
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
    budget_amount: Optional[Decimal] = Field(
        None,
        description="Проходной бюджет клиента (та же валюта, что у суммы); не расход компании при учёте в P&L",
    )
    currency: str = Field(default="USD", max_length=3)
    status: str = Field(default="not_started", max_length=30)
    paid: bool = False


class EmployeeTaskCreate(EmployeeTaskBase):
    """Для админа в теле запроса передайте user_id — задача будет создана для этого сотрудника."""

    user_id: Optional[int] = Field(
        default=None,
        description="Только админ: ID пользователя с ролью employee",
    )
    allocated_payment_id: Optional[int] = Field(None, description="Только админ: проект из «Проекты» для учёта себестоимости")
    cost_category: Optional[str] = Field(
        None,
        description="Только админ: design | dev | other | seo",
        max_length=20,
    )


class EmployeeTaskUpdate(BaseModel):
    work_date: Optional[date] = None
    project_name: Optional[str] = Field(None, max_length=300)
    task_description: Optional[str] = Field(None, max_length=600)
    task_url: Optional[str] = Field(None, max_length=800)
    hours: Optional[Decimal] = None
    amount: Optional[Decimal] = None
    budget_amount: Optional[Decimal] = None
    currency: Optional[str] = Field(None, max_length=3)
    status: Optional[str] = Field(None, max_length=30)
    paid: Optional[bool] = None
    allocated_payment_id: Optional[int] = None
    cost_category: Optional[str] = Field(None, max_length=20)


class EmployeeTaskOut(EmployeeTaskBase):
    id: int
    user_id: int
    created_at: datetime
    paid_at: Optional[datetime] = None
    done_at: Optional[datetime] = None
    allocated_payment_id: Optional[int] = None
    cost_category: Optional[str] = None
    allocated_payment_label: Optional[str] = Field(None, description="Подпись проекта для админки")

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
    budget_amount: Decimal = Decimal("0")
    currency: str
    note: Optional[str] = None
    has_receipt: bool
    entered_by: str  # self | admin
    created_at: datetime


class EmployeePayrollExpenseOut(BaseModel):
    """Выплата сотруднику, внесённая админом (Команда → запись о выплате) — для раздела «Финансы → Расходы»."""

    id: int
    user_id: int
    employee_name: str
    paid_on: date
    period_year: Optional[int] = None
    period_month: Optional[int] = None
    amount: Decimal
    budget_amount: Decimal = Decimal("0")
    operating_amount: Decimal = Field(
        ...,
        description="Сумма, учитываемая как расход / в P&L (amount − budget_amount)",
    )
    currency: str
    note: Optional[str] = None
    has_receipt: bool
    created_at: datetime


class StaffEmployeeOut(BaseModel):
    id: int
    name: str
    email: str
    payment_details: Optional[str] = None
    payment_details_updated_at: Optional[datetime] = None
    task_count: int = 0
    is_ad_budget_employee: bool = False


class StaffMonthTotalsOut(BaseModel):
    year: int
    month: int
    label: str
    total_usd: Decimal
    total_uzs: Decimal
    total_hours: Decimal
    total_budget_usd: Decimal = Decimal("0")
    total_budget_uzs: Decimal = Decimal("0")


class StaffPendingPaymentMonthOut(BaseModel):
    year: int
    month: int
    label: str
    total_usd: Decimal
    total_uzs: Decimal
    total_hours: Decimal
    task_count: int
    total_budget_usd: Decimal = Decimal("0")
    total_budget_uzs: Decimal = Decimal("0")


AccessEntryCategory = Literal["email", "telegram", "device", "service"]


class AccessEntryBase(BaseModel):
    employee_name: str = Field(..., max_length=160)
    category: AccessEntryCategory
    title: str = Field(..., max_length=220)
    service_type: Optional[str] = Field(None, max_length=120)
    shared_with_administration: bool = False
    login: Optional[str] = Field(None, max_length=320)
    password: Optional[str] = None
    phone_number: Optional[str] = Field(None, max_length=40)
    twofa_code: Optional[str] = Field(None, max_length=120)
    reserve_email: Optional[str] = Field(None, max_length=220)
    device_model: Optional[str] = Field(None, max_length=220)
    serial_number: Optional[str] = Field(None, max_length=220)
    charge_cycles: Optional[int] = Field(None, ge=0, le=2000)
    photo_url: Optional[str] = Field(None, max_length=900)
    notes: Optional[str] = None


class AccessEntryCreate(AccessEntryBase):
    pass


class AccessEntryUpdate(BaseModel):
    employee_name: Optional[str] = Field(None, max_length=160)
    category: Optional[AccessEntryCategory] = None
    title: Optional[str] = Field(None, max_length=220)
    service_type: Optional[str] = Field(None, max_length=120)
    shared_with_administration: Optional[bool] = None
    login: Optional[str] = Field(None, max_length=320)
    password: Optional[str] = None
    phone_number: Optional[str] = Field(None, max_length=40)
    twofa_code: Optional[str] = Field(None, max_length=120)
    reserve_email: Optional[str] = Field(None, max_length=220)
    device_model: Optional[str] = Field(None, max_length=220)
    serial_number: Optional[str] = Field(None, max_length=220)
    charge_cycles: Optional[int] = Field(None, ge=0, le=2000)
    photo_url: Optional[str] = Field(None, max_length=900)
    notes: Optional[str] = None


class AccessEntryOut(AccessEntryBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


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
    trashed_at: Optional[datetime] = None
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
    project_category: Optional[str] = None  # smm | target | personal_brand | content | hosting_domain | legacy web…
    billing_variant: Optional[str] = None
    # tech_monthly_plus_extra | tech_piecework | hosting_subscription
    billing_notes: Optional[str] = None
    hosting_contact_name: Optional[str] = None
    hosting_payment_kind: Optional[str] = None
    hosting_renewal_anchor: Optional[date] = None
    hosting_prepaid_years: int = 0


class PaymentCreate(PaymentBase):
    pass


# ── PAYMENT MONTHS ─────────────────────────────────────────────────────────────
class PaymentMonthCreate(BaseModel):
    month: str   # YYYY-MM
    amount: Optional[Decimal] = None
    description: Optional[str] = None
    note: Optional[str] = None
    due_date: Optional[date] = None  # срок оплаты; если не задан — из day_of_month договора или конец месяца


class PaymentMonthUpdate(BaseModel):
    """Частичное обновление строки графика (месяц/год). Пустое тело — без изменений."""

    month: Optional[str] = None  # YYYY-MM
    amount: Optional[Decimal] = None  # None — как при создании: полная сумма договора
    description: Optional[str] = None
    note: Optional[str] = None
    due_date: Optional[date] = None


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
    received_payment_method: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class PaymentMonthConfirmIn(BaseModel):
    """Тело POST «Оплата прошла» по строке графика."""

    received_payment_method: str = "transfer"
    paid_at: Optional[datetime] = None

    @field_validator("received_payment_method")
    @classmethod
    def _v_recv_pm(cls, v: str) -> str:
        s = (v or "transfer").strip().lower()
        if s not in ("transfer", "card", "cash"):
            raise ValueError("Способ поступления: transfer | card | cash")
        return s


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
    project_category: Optional[str] = None  # smm | target | personal_brand | content | hosting_domain | legacy web…
    billing_variant: Optional[str] = None
    billing_notes: Optional[str] = None
    hosting_contact_name: Optional[str] = None
    hosting_payment_kind: Optional[str] = None
    hosting_renewal_anchor: Optional[date] = None
    hosting_prepaid_years: Optional[int] = None


class PaymentConfirm(BaseModel):
    postpone_days: Optional[int] = 0
    received_payment_method: Optional[str] = None

    @field_validator("received_payment_method")
    @classmethod
    def _v_pay_confirm_pm(cls, v: Optional[str]) -> Optional[str]:
        if v is None or str(v).strip() == "":
            return None
        s = str(v).strip().lower()
        if s not in ("transfer", "card", "cash"):
            raise ValueError("Способ поступления: transfer | card | cash")
        return s


class PaymentOut(PaymentBase):
    id: int
    status: str
    paid_at: Optional[datetime] = None
    confirmed_by: Optional[int] = None
    received_payment_method: Optional[str] = None
    postponed_until: Optional[date] = None
    last_notified_at: Optional[datetime] = None
    is_archived: bool
    trashed_at: Optional[datetime] = None
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


# ── FINANCE / PROJECTS COST ─────────────────────────────────────────────────────
class ProjectCostScheduleMonthOut(BaseModel):
    """Одна строка графика оплат по проекту (payment_months)."""

    month_id: int
    month: str  # YYYY-MM
    amount: Decimal
    status: str
    due_date: Optional[date] = None
    paid_at: Optional[datetime] = None
    description: Optional[str] = None


class PLCellOut(BaseModel):
    """Одна ячейка P&L за месяц (выручка в UZS; выплаты команды — UZS и/или USD)."""

    uzs: Decimal = Decimal("0")
    usd: Decimal = Decimal("0")


class PLDataRowOut(BaseModel):
    row_id: str
    label: str
    section: str  # revenue | expenses_fixed | summary
    is_calculated: bool = False
    is_manual: bool = False
    manual_line_id: Optional[int] = None
    link_to_net_profit: bool = False
    cells: List[PLCellOut]


class PLReportOut(BaseModel):
    year: int
    columns: List[str]  # YYYY-MM, 12 шт.
    rows: List[PLDataRowOut]


class PLManualLineCreate(BaseModel):
    section: Literal["revenue", "expenses_fixed", "summary"]
    label: str = Field(..., min_length=1, max_length=200)
    sort_order: int = 0
    link_to_net_profit: bool = False


class PLManualLineUpdate(BaseModel):
    label: Optional[str] = Field(None, min_length=1, max_length=200)
    section: Optional[Literal["revenue", "expenses_fixed", "summary"]] = None
    sort_order: Optional[int] = None
    link_to_net_profit: Optional[bool] = None


class PLManualLineOut(BaseModel):
    id: int
    section: str
    label: str
    sort_order: int
    link_to_net_profit: bool = False


class PLManualCellPut(BaseModel):
    period_month: str = Field(..., pattern=r"^\d{4}-\d{2}$")
    uzs: Decimal = Decimal("0")
    usd: Decimal = Decimal("0")


class CashFlowTemplateLineOut(BaseModel):
    id: int
    template_group: str
    sort_order: int
    label: str
    default_amount_uzs: Decimal
    default_amount_usd: Decimal
    flow_category: str
    payment_method: str
    direction: str

    class Config:
        from_attributes = True


class CashFlowTemplateLineCreate(BaseModel):
    template_group: str = Field(..., min_length=1, max_length=40)
    label: str = Field(..., min_length=1, max_length=200)
    default_amount_uzs: Decimal = Decimal("0")
    default_amount_usd: Decimal = Decimal("0")
    flow_category: str = Field(..., max_length=64)
    payment_method: str = "transfer"
    direction: Literal["income", "expense"] = "expense"
    sort_order: Optional[int] = None

    @field_validator("payment_method")
    @classmethod
    def _tpl_pm(cls, v: str) -> str:
        ok = {"cash", "card", "transfer"}
        if v not in ok:
            raise ValueError("Форма оплаты: cash, card или transfer")
        return v


class CashFlowTemplateLineUpdate(BaseModel):
    template_group: Optional[str] = Field(None, max_length=40)
    label: Optional[str] = Field(None, max_length=200)
    default_amount_uzs: Optional[Decimal] = None
    default_amount_usd: Optional[Decimal] = None
    flow_category: Optional[str] = Field(None, max_length=64)
    payment_method: Optional[str] = None
    direction: Optional[Literal["income", "expense"]] = None
    sort_order: Optional[int] = None

    @field_validator("payment_method")
    @classmethod
    def _tpl_pm2(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        ok = {"cash", "card", "transfer"}
        if v not in ok:
            raise ValueError("Форма оплаты: cash, card или transfer")
        return v


class CashFlowEntryOut(BaseModel):
    id: int
    period_month: str
    entry_date: Optional[date] = None
    direction: str
    label: str
    amount_uzs: Decimal
    amount_usd: Decimal
    apply_fx_to_uzs: bool = False
    payment_method: str
    flow_category: Optional[str] = None
    recipient: Optional[str] = None
    payment_id: Optional[int] = None
    notes: Optional[str] = None
    template_line_id: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


class CashFlowEntryCreate(BaseModel):
    period_month: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}$")
    entry_date: Optional[date] = None
    direction: Literal["income", "expense"]
    label: str = Field(..., min_length=1, max_length=300)
    amount_uzs: Decimal = Decimal("0")
    amount_usd: Decimal = Decimal("0")
    apply_fx_to_uzs: bool = False
    payment_method: str = "transfer"
    flow_category: Optional[str] = Field(None, max_length=64)
    recipient: Optional[str] = Field(None, max_length=120)
    payment_id: Optional[int] = None
    notes: Optional[str] = Field(None, max_length=500)

    @model_validator(mode="after")
    def _period_or_entry_date(self):
        if self.entry_date is not None or (self.period_month and str(self.period_month).strip()):
            return self
        raise ValueError("Укажите месяц учёта (YYYY-MM) или дату операции")

    @field_validator("payment_method")
    @classmethod
    def _pm(cls, v: str) -> str:
        ok = {"cash", "card", "transfer"}
        if v not in ok:
            raise ValueError("Форма оплаты: cash, card или transfer")
        return v


class CashFlowEntryUpdate(BaseModel):
    label: Optional[str] = Field(None, max_length=300)
    amount_uzs: Optional[Decimal] = None
    amount_usd: Optional[Decimal] = None
    apply_fx_to_uzs: Optional[bool] = None
    payment_method: Optional[str] = None
    flow_category: Optional[str] = Field(None, max_length=64)
    recipient: Optional[str] = Field(None, max_length=120)
    payment_id: Optional[int] = None
    notes: Optional[str] = Field(None, max_length=500)

    @field_validator("payment_method")
    @classmethod
    def _pm2(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        ok = {"cash", "card", "transfer"}
        if v not in ok:
            raise ValueError("Форма оплаты: cash, card или transfer")
        return v


class ApplyCashFlowTemplateIn(BaseModel):
    period_month: str = Field(..., pattern=r"^\d{4}-\d{2}$")
    template_groups: List[str] = Field(..., min_length=1)


class CashFlowMetaOut(BaseModel):
    payment_methods: List[Dict[str, str]]
    expense_categories: List[Dict[str, str]]
    income_categories: List[Dict[str, str]]
    template_groups: List[Dict[str, str]]


class CashFlowPaymentOptionOut(BaseModel):
    id: int
    label: str
    partner_name: str


class ProjectCostBreakdownPut(BaseModel):
    """Разбивка себестоимости по статьям (UZS); сумма попадает в internal_cost_sum."""

    cost_design_uzs: Decimal = Field(ge=Decimal("0"), default=Decimal("0"))
    cost_dev_uzs: Decimal = Field(ge=Decimal("0"), default=Decimal("0"))
    cost_other_uzs: Decimal = Field(ge=Decimal("0"), default=Decimal("0"))
    cost_seo_uzs: Decimal = Field(ge=Decimal("0"), default=Decimal("0"))


class ProjectCostRowOut(BaseModel):
    """Сводка по проекту для отчёта «Projects Cost»: синхронизировано с payments / payment_months."""

    payment_id: int
    partner_id: int
    partner_name: str
    project_name: str
    project_category: Optional[str] = None
    payment_type: str
    is_recurring_billing: bool
    amount_basis: str  # monthly | contract_total
    contract_total: Optional[Decimal] = None
    billing_unit_amount: Decimal
    sum_paid_actual: Decimal
    paid_percent: Optional[Decimal] = None
    pm_name: Optional[str] = None
    project_start: date
    schedule_months: List[ProjectCostScheduleMonthOut] = []
    # Отображаемые суммы (ручной ввод в Projects Cost + распределение из задач «Команда»)
    cost_design_uzs: Decimal
    cost_dev_uzs: Decimal
    cost_other_uzs: Decimal
    cost_seo_uzs: Decimal
    # Ручной ввод (редактируемые ячейки); без задач совпадают с cost_*_uzs
    cost_design_manual_uzs: Decimal = Decimal("0")
    cost_dev_manual_uzs: Decimal = Decimal("0")
    cost_other_manual_uzs: Decimal = Decimal("0")
    cost_seo_manual_uzs: Decimal = Decimal("0")
    tasks_cost_design_uzs: Decimal = Decimal("0")
    tasks_cost_dev_uzs: Decimal = Decimal("0")
    tasks_cost_other_uzs: Decimal = Decimal("0")
    tasks_cost_seo_uzs: Decimal = Decimal("0")
    internal_cost_sum: Decimal = Decimal("0")
    profit_actual: Decimal
    manager_commission_percent: Optional[Decimal] = None  # % из привязанной записи «Комиссия»
    manager_commission_reserved_uzs: Optional[Decimal] = None  # маржа × % / 100
    profit_after_manager_uzs: Decimal  # маржа − резерв комиссии (если % нет — как profit_actual)


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
    received_payment_method: Optional[str] = None


class AvailableFundsOut(BaseModel):
    period_month: str
    on_account_uzs: Decimal
    on_cards_uzs: Decimal
    deposits_uzs: Decimal
    from_payments_account_uzs: Decimal
    from_payments_cards_uzs: Decimal
    adjust_account_uzs: Decimal
    adjust_cards_uzs: Decimal
    usd_to_uzs_rate: Decimal = Decimal("0")


class AvailableFundsManualPut(BaseModel):
    period_month: str = Field(..., pattern=r"^\d{4}-\d{2}$")
    deposits_uzs: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))
    adjust_account_uzs: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))
    adjust_cards_uzs: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))
    usd_to_uzs_rate: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))


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


class CeoLayoutBlockIn(BaseModel):
    kind: Literal["client_history", "turnover", "pl_row", "ltv"]
    title: Optional[str] = Field(None, max_length=200)
    pl_row_id: Optional[str] = Field(None, max_length=80)


class CeoLayoutPut(BaseModel):
    blocks: List[CeoLayoutBlockIn]


class CeoLayoutBlockOut(BaseModel):
    id: int
    kind: str
    title: Optional[str] = None
    pl_row_id: Optional[str] = None
    sort_order: int


class CeoLayoutOut(BaseModel):
    blocks: List[CeoLayoutBlockOut]


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
    role: str  # manager | accountant | administration
    name: str
    email: Optional[str] = None
    link_user_id: Optional[int] = None  # привязать Chat ID к существующему пользователю
    visible_manager_ids: Optional[List[int]] = None  # для новой administration


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
    received_amount_1_on: Optional[date] = None  # дата для P&L (касса)
    received_amount_2_on: Optional[date] = None
    commission_paid_full: bool = False
    project_date: date
    note: Optional[str] = None
    payment_id: Optional[int] = None          # привязка к проекту в «Проекты»


class CommissionCreate(CommissionBase):
    manager_id: Optional[int] = None           # admin may override
    duplicate_months: int = Field(
        0,
        ge=0,
        le=36,
        description="Сколько раз продублировать карточку на следующие месяцы (та же сумма и %): 0 — только одна запись",
    )


class CommissionUpdate(BaseModel):
    project_name: Optional[str] = None
    project_type: Optional[str] = None
    project_cost: Optional[Decimal] = None
    production_cost: Optional[Decimal] = None
    manager_percent: Optional[Decimal] = None
    actual_payment: Optional[Decimal] = None
    received_amount_1: Optional[Decimal] = None
    received_amount_2: Optional[Decimal] = None
    received_amount_1_on: Optional[date] = None
    received_amount_2_on: Optional[date] = None
    commission_paid_full: Optional[bool] = None
    project_date: Optional[date] = None
    note: Optional[str] = None
    manager_id: Optional[int] = None
    payment_id: Optional[int] = None


class CommissionOut(CommissionBase):
    id: int
    manager_id: int
    manager: Optional["UserOut"] = None
    created_at: datetime
    linked_payment_description: Optional[str] = None
    linked_partner_name: Optional[str] = None
    # Computed fields (filled in route)
    profit: Decimal = Decimal(0)
    total_manager_income: Decimal = Decimal(0)
    manager_income_from_actual: Decimal = Decimal(0)
    total_received: Decimal = Decimal(0)

    class Config:
        from_attributes = True


class CommissionLinkablePaymentOut(BaseModel):
    """Проекты из «Проекты» для привязки комиссии (все компании; ПМ ведения — справочно)."""

    id: int
    description: str
    partner_name: str
    partner_manager_name: Optional[str] = None


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
