"""Provider-independent AI layer with strict output validation.

AI is only ever used to *word* a message. It never decides amounts, statuses or
permissions, and every output is validated before use. When the provider fails
or the output is rejected, callers fall back to the deterministic template.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field, ValidationError

Tone = Literal["friendly", "professional", "firm", "final"]


class AIError(Exception):
    """Provider unavailable, malformed output, or output rejected by the safety rules."""


class ReminderDraft(BaseModel):
    subject: str = Field(min_length=5, max_length=160)
    body: str = Field(min_length=60, max_length=3000)


class InvoiceExtraction(BaseModel):
    invoice_number: str | None = Field(default=None, max_length=60)
    customer_name: str | None = Field(default=None, max_length=200)
    issue_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    due_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    subtotal: str | None = Field(default=None, pattern=r"^\d+(\.\d{1,2})?$")
    tax: str | None = Field(default=None, pattern=r"^\d+(\.\d{1,2})?$")
    total: str | None = Field(default=None, pattern=r"^\d+(\.\d{1,2})?$")


@dataclass(frozen=True)
class ProviderConfig:
    provider: str  # openrouter | openai | anthropic | openai_compatible
    model: str
    api_key: str
    base_url: str | None = None


BASE_URLS = {
    "openrouter": "https://openrouter.ai/api/v1",
    "openai": "https://api.openai.com/v1",
}

# Content that must never reach a customer. Matched case-insensitively.
FORBIDDEN = [
    (r"\b(legal action|lawsuit|sue|suing|court|lawyer|attorney|solicitor|litigation|legal proceedings)\b", "legal threats"),
    (r"\b(police|arrest|criminal|prosecut\w*|jail|prison)\b", "criminal threats"),
    (r"\b(credit (score|rating|bureau|report)|cibil|blacklist\w*|default notice)\b", "credit consequences"),
    (r"\b(debt collect\w*|collection agenc\w*|bailiff|recovery agent)\b", "collection agency threats"),
    (r"\b(we|i) (have )?(received|got) your payment\b|\bthank you for your payment\b|\bpayment (has been )?received\b", "claims payment was received"),
    (r"\b(late fee|penalty|interest charge|surcharge)\w*\b", "invented charges"),
    (r"\b(guarantee|promise) (that )?(we|i) will\b", "commitments on the business's behalf"),
    (r"https?://", "links (only the system-added unsubscribe link is allowed)"),
]


def validate_reminder(draft: ReminderDraft, *, invoice_number: str, amount: str, allow_fees: bool = False) -> ReminderDraft:
    """Raises AIError when a draft is unsafe or inaccurate."""
    text = f"{draft.subject}\n{draft.body}"
    for pattern, label in FORBIDDEN:
        if label == "invented charges" and allow_fees:
            continue
        if re.search(pattern, text, re.IGNORECASE):
            raise AIError(f"draft rejected: contains {label}")
    if "{{" in text or "}}" in text:
        raise AIError("draft rejected: unfilled placeholder")
    if invoice_number not in text:
        raise AIError("draft rejected: does not reference the invoice number")
    if amount not in text:
        raise AIError("draft rejected: does not state the exact outstanding amount")
    # Every monetary figure must be the real one; the model must not invent amounts.
    figures = set(re.findall(r"\d[\d,]*\.\d{2}", text))
    allowed = set(re.findall(r"\d[\d,]*\.\d{2}", amount))
    if figures - allowed:
        raise AIError("draft rejected: mentions amounts other than the outstanding balance")
    return draft


def parse_json_object(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", cleaned, re.DOTALL)
    if fenced:
        cleaned = fenced.group(1)
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start == -1 or end <= start:
        raise AIError("model did not return a JSON object")
    try:
        value = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError as exc:
        raise AIError(f"invalid JSON from model: {exc}") from exc
    if not isinstance(value, dict):
        raise AIError("model did not return a JSON object")
    return value


class AIClient:
    def __init__(self, config: ProviderConfig, timeout: float = 25.0, transport: httpx.BaseTransport | None = None) -> None:
        self.config = config
        self.http = httpx.Client(timeout=timeout, transport=transport)

    def complete_json(self, system: str, user: str, max_tokens: int = 900) -> dict[str, Any]:
        cfg = self.config
        try:
            if cfg.provider == "anthropic":
                response = self.http.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={"x-api-key": cfg.api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                    json={"model": cfg.model, "max_tokens": max_tokens, "system": system, "messages": [{"role": "user", "content": user}]},
                )
                response.raise_for_status()
                blocks = response.json().get("content", [])
                text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text")
            else:
                base = (cfg.base_url or BASE_URLS.get(cfg.provider, "")).rstrip("/")
                if not base.startswith("https://"):
                    raise AIError("AI provider base URL must use https")
                response = self.http.post(
                    f"{base}/chat/completions",
                    headers={"Authorization": f"Bearer {cfg.api_key}", "content-type": "application/json"},
                    json={
                        "model": cfg.model, "max_tokens": max_tokens, "temperature": 0.4,
                        "response_format": {"type": "json_object"},
                        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                    },
                )
                response.raise_for_status()
                text = response.json()["choices"][0]["message"]["content"] or ""
        except httpx.HTTPStatusError as exc:
            raise AIError(f"AI provider returned HTTP {exc.response.status_code}") from exc
        except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
            raise AIError(f"AI provider request failed: {type(exc).__name__}") from exc
        return parse_json_object(text)

    def draft_reminder(self, context: dict[str, Any], tone: Tone) -> ReminderDraft:
        system = (
            "You write accounts-receivable payment reminder emails on behalf of a business. "
            "Rules: be courteous, factual and concise. Use the tone requested. "
            "Never threaten, never mention legal action, courts, police, credit scores, collection agencies, "
            "late fees, penalties or interest. Never claim a payment was received. Never invent facts, amounts, "
            "dates, discounts or links. State the exact outstanding amount and invoice number given. "
            "If a payment history note is given, you may acknowledge it gently. "
            "Sign off with the business name. Do not include a signature block beyond that. "
            'Reply with JSON only: {"subject": string, "body": string}. The body is plain text with line breaks.'
        )
        user = json.dumps({"tone": tone, **context}, default=str)
        raw = self.complete_json(system, user)
        try:
            draft = ReminderDraft.model_validate(raw)
        except ValidationError as exc:
            raise AIError(f"draft failed schema validation: {exc.error_count()} errors") from exc
        return validate_reminder(draft, invoice_number=str(context["invoice_number"]), amount=str(context["amount_outstanding"]))

    def extract_invoice(self, document_text: str) -> InvoiceExtraction:
        system = (
            "Extract invoice fields from the document text. Return JSON with keys invoice_number, customer_name, "
            "issue_date (YYYY-MM-DD), due_date (YYYY-MM-DD), currency (ISO 4217), subtotal, tax, total "
            "(plain decimals, no symbols or separators). Use null for anything not clearly present. Do not guess."
        )
        raw = self.complete_json(system, document_text[:12000], max_tokens=500)
        try:
            return InvoiceExtraction.model_validate(raw)
        except ValidationError as exc:
            raise AIError(f"extraction failed schema validation: {exc.error_count()} errors") from exc
