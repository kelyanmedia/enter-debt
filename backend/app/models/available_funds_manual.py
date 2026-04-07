from sqlalchemy import Column, String, Numeric, PrimaryKeyConstraint

from app.db.database import Base


class AvailableFundsManual(Base):
    """Ручной ввод по месяцу: вклады + доп. суммы к расчёту из оплат (счёт / карты)."""

    __tablename__ = "available_funds_manual"
    __table_args__ = (PrimaryKeyConstraint("company_slug", "period_month"),)

    company_slug = Column(String(32), nullable=False)
    period_month = Column(String(7), nullable=False)
    deposits_uzs = Column(Numeric(15, 2), nullable=False, default=0)
    adjust_account_uzs = Column(Numeric(15, 2), nullable=False, default=0)
    adjust_cards_uzs = Column(Numeric(15, 2), nullable=False, default=0)
    # Курс для P&L: суммы в USD (ДДС, выплаты команде в $) переводятся в UZS как amount_usd * rate
    usd_to_uzs_rate = Column(Numeric(15, 4), nullable=False, default=0)
