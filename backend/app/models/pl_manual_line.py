"""Ручные строки P&L (постоянные расходы или блок «Итог») — на компанию."""

from sqlalchemy import Boolean, Column, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import relationship

from app.db.database import Base


class PlManualLine(Base):
    __tablename__ = "pl_manual_lines"

    id = Column(Integer, primary_key=True, index=True)
    company_slug = Column(String(32), nullable=False, index=True)
    section = Column(String(32), nullable=False)  # revenue | expenses_fixed | summary
    label = Column(String(200), nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)
    # Для ручных расходов: строка считается распределением чистой прибыли / дивидендами учредителей.
    link_to_net_profit = Column(Boolean, nullable=False, default=False)

    cells = relationship("PlManualMonthCell", back_populates="line", cascade="all, delete-orphan")


class PlManualMonthCell(Base):
    __tablename__ = "pl_manual_month_cells"

    id = Column(Integer, primary_key=True, index=True)
    line_id = Column(Integer, ForeignKey("pl_manual_lines.id", ondelete="CASCADE"), nullable=False, index=True)
    period_month = Column(String(7), nullable=False)  # YYYY-MM
    amount_uzs = Column(Numeric(15, 2), nullable=False, default=0)
    amount_usd = Column(Numeric(15, 2), nullable=False, default=0)

    line = relationship("PlManualLine", back_populates="cells")

    __table_args__ = (UniqueConstraint("line_id", "period_month", name="uq_pl_manual_cell_line_month"),)
