from sqlalchemy import Column, String, Numeric

from app.db.database import Base


class AvailableFundsManual(Base):
    """Ручной ввод по месяцу: вклады + доп. суммы к расчёту из оплат (счёт / карты)."""

    __tablename__ = "available_funds_manual"

    period_month = Column(String(7), primary_key=True)
    deposits_uzs = Column(Numeric(15, 2), nullable=False, default=0)
    adjust_account_uzs = Column(Numeric(15, 2), nullable=False, default=0)
    adjust_cards_uzs = Column(Numeric(15, 2), nullable=False, default=0)
