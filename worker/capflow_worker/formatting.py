"""Money/date formatting and template rendering, matching the web app's output."""

from __future__ import annotations

import re
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

SYMBOLS = {"INR": "₹", "USD": "$", "GBP": "£", "EUR": "€", "AED": "AED ", "SGD": "S$", "AUD": "A$", "CAD": "CA$"}

TEMPLATE_VARIABLES = (
    "customer_name", "invoice_number", "amount_outstanding", "invoice_total",
    "due_date", "days_overdue", "organisation_name", "payment_reference",
)
_PLACEHOLDER = re.compile(r"\{\{\s*([a-z_]+)\s*\}\}")


def _group(digits: str, indian: bool) -> str:
    if not indian or len(digits) <= 3:
        return f"{int(digits):,}"
    head, tail = digits[:-3], digits[-3:]
    parts: list[str] = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    if head:
        parts.insert(0, head)
    return ",".join(parts) + "," + tail


def format_money(amount: Decimal | str | int, currency: str) -> str:
    value = Decimal(str(amount)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    sign = "-" if value < 0 else ""
    whole, frac = f"{abs(value):.2f}".split(".")
    symbol = SYMBOLS.get(currency, f"{currency} ")
    return f"{sign}{symbol}{_group(whole, currency == 'INR')}.{frac}"


def format_date(value: date) -> str:
    return value.strftime("%d %b %Y")


def render(template: str, variables: dict[str, str]) -> str:
    return _PLACEHOLDER.sub(lambda m: variables.get(m.group(1), m.group(0)), template)


def leftover_placeholders(text: str) -> list[str]:
    return _PLACEHOLDER.findall(text)
