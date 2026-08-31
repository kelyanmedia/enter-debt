"""НДС по проектам: в договоре хранится сумма с НДС, в финансовых отчётах — без НДС."""
from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any


VAT_RATES = frozenset((Decimal("0"), Decimal("6"), Decimal("12")))
_MONEY = Decimal("0.01")


def normalize_vat_rate(value: Any) -> Decimal:
    """Безопасный rate для существующих данных: только 0%, 6% или 12%."""
    try:
        rate = Decimal(str(value if value is not None else 0)).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")
    return rate if rate in VAT_RATES else Decimal("0")


def gross_amount_from_net(net_amount: Any, vat_rate: Any) -> Decimal:
    """Цена услуги + НДС сверху: 80 000 000 при 6% = 84 800 000."""
    net = Decimal(str(net_amount or 0))
    rate = normalize_vat_rate(vat_rate)
    return (net * (Decimal("100") + rate) / Decimal("100")).quantize(_MONEY, rounding=ROUND_HALF_UP)


def net_amount_from_gross(gross_amount: Any, vat_rate: Any) -> Decimal:
    """Чистая выручка из суммы договора с НДС; это не gross − gross × rate."""
    gross = Decimal(str(gross_amount or 0))
    rate = normalize_vat_rate(vat_rate)
    return (gross * Decimal("100") / (Decimal("100") + rate)).quantize(_MONEY, rounding=ROUND_HALF_UP)


def payment_net_amount(payment: Any, gross_amount: Any = None) -> Decimal:
    """Чистая сумма конкретной оплаты проекта (строки графика или всего договора)."""
    gross = gross_amount if gross_amount is not None else getattr(payment, "amount", 0)
    return net_amount_from_gross(gross, getattr(payment, "vat_rate", 0))


def payment_vat_amount(payment: Any, gross_amount: Any = None) -> Decimal:
    gross = Decimal(str(gross_amount if gross_amount is not None else getattr(payment, "amount", 0) or 0))
    return (gross - payment_net_amount(payment, gross)).quantize(_MONEY, rounding=ROUND_HALF_UP)
