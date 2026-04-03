from sqlalchemy import Column, Integer, String, Text, ForeignKey, DateTime, Date, Numeric, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.database import Base


class Payment(Base):
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, index=True)
    partner_id = Column(Integer, ForeignKey("partners.id"), nullable=False)
    payment_type = Column(String(30), nullable=False)
    description = Column(String(300), nullable=False)
    amount = Column(Numeric(15, 2), nullable=False)
    contract_months = Column(Integer, nullable=True)

    day_of_month = Column(Integer, nullable=True)
    deadline_date = Column(Date, nullable=True)

    remind_days_before = Column(Integer, default=3)
    status = Column(String(20), nullable=False, default="pending")
    paid_at = Column(DateTime(timezone=True), nullable=True)
    confirmed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    postponed_until = Column(Date, nullable=True)

    last_notified_at = Column(DateTime(timezone=True), nullable=True)
    is_archived = Column(Boolean, default=False)
    trashed_at = Column(DateTime(timezone=True), nullable=True, index=True)
    notify_accounting = Column(Boolean, default=True)
    contract_url = Column(String(500), nullable=True)
    service_period = Column(String(20), nullable=True)  # monthly / yearly — for service_expiry type
    project_category = Column(String(20), nullable=True)  # web | seo | ppc | mobile_app | tech_support | hosting_domain
    # Режим оплаты для техподдержки / хостинга (остальные линии — NULL)
    billing_variant = Column(String(40), nullable=True)
    billing_notes = Column(Text, nullable=True)  # доп. работы, комментарий к сдельной задаче
    # Хостинг/домен (project_category = hosting_domain)
    hosting_contact_name = Column(String(200), nullable=True)
    hosting_payment_kind = Column(String(120), nullable=True)  # вид оплаты (карта, счёт, …)
    hosting_renewal_anchor = Column(Date, nullable=True)  # дата очередного ежегодного продления (без сдвига лет предоплаты)
    hosting_prepaid_years = Column(Integer, nullable=False, default=0)  # 0–3: оплата на N лет вперёд → срок в таблице = якорь + N лет
    received_payment_method = Column(String(20), nullable=True)  # для проекта без графика месяцев
    # Разбивка себестоимости Projects Cost (сумма колонок = «Себест.», прибыль = оплата факт − сумма)
    projects_cost_design_uzs = Column(Numeric(15, 2), nullable=False, default=0)
    projects_cost_dev_uzs = Column(Numeric(15, 2), nullable=False, default=0)
    projects_cost_other_uzs = Column(Numeric(15, 2), nullable=False, default=0)
    projects_cost_seo_uzs = Column(Numeric(15, 2), nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    partner = relationship("Partner", back_populates="payments")
    confirmed_by_user = relationship("User", back_populates="confirmed_payments")
    notification_logs = relationship("NotificationLog", back_populates="payment")
    months = relationship("PaymentMonth", back_populates="payment", cascade="all, delete-orphan", order_by="PaymentMonth.month")


class PaymentMonth(Base):
    __tablename__ = "payment_months"

    id = Column(Integer, primary_key=True, index=True)
    payment_id = Column(Integer, ForeignKey("payments.id", ondelete="CASCADE"), nullable=False)
    month = Column(String(7), nullable=False)   # YYYY-MM (период услуги / акт)
    due_date = Column(Date, nullable=True)      # срок оплаты (календарный день)
    amount = Column(Numeric(15, 2), nullable=True)
    status = Column(String(20), nullable=False, default="pending")  # pending / paid
    description = Column(String(300), nullable=True)  # e.g. "SEO Март 2026 Акт/СФ"
    note = Column(String(300), nullable=True)
    paid_at = Column(DateTime(timezone=True), nullable=True)
    confirmed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    act_issued = Column(Boolean, nullable=False, default=False)
    act_issued_at = Column(DateTime(timezone=True), nullable=True)
    # Как пришли деньги при «Оплата прошла»: transfer → счёт, card|cash → карты в «Доступные средства»
    received_payment_method = Column(String(20), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    payment = relationship("Payment", back_populates="months")
    confirmed_by_user = relationship("User", foreign_keys=[confirmed_by])


class NotificationLog(Base):
    __tablename__ = "notification_logs"

    id = Column(Integer, primary_key=True, index=True)
    payment_id = Column(Integer, ForeignKey("payments.id"), nullable=False)
    sent_to_chat_id = Column(String(50), nullable=False)
    sent_to_name = Column(String(100), nullable=True)
    message_text = Column(Text, nullable=True)
    status = Column(String(20), default="sent")  # sent / error
    sent_at = Column(DateTime(timezone=True), server_default=func.now())

    payment = relationship("Payment", back_populates="notification_logs")
