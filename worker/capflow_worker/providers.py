"""Message delivery adapters. Each returns a SendResult; none ever reports success
unless the provider accepted the message."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import httpx


@dataclass(frozen=True)
class OutboundMessage:
    to: str
    subject: str | None
    body: str
    idempotency_key: str
    from_name: str | None = None
    reply_to: str | None = None
    unsubscribe_url: str | None = None
    # WhatsApp template parameters, in order
    template_params: tuple[str, ...] = ()


@dataclass(frozen=True)
class SendResult:
    ok: bool
    provider: str
    message_id: str | None = None
    error: str | None = None
    # True when retrying may succeed (network errors, 429, 5xx).
    retryable: bool = False
    # True when no live provider exists: nothing was delivered.
    sandbox: bool = False


class Sender(Protocol):
    provider: str

    def send(self, message: OutboundMessage) -> SendResult: ...


def _classify(provider: str, exc: Exception) -> SendResult:
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        detail = exc.response.text[:300]
        return SendResult(False, provider, error=f"HTTP {code}: {detail}", retryable=code == 429 or code >= 500)
    return SendResult(False, provider, error=f"{type(exc).__name__}: {exc}", retryable=True)


class SandboxSender:
    """Used when no provider is configured. Records the attempt; delivers nothing."""

    def __init__(self, provider: str = "sandbox") -> None:
        self.provider = provider

    def send(self, message: OutboundMessage) -> SendResult:
        return SendResult(False, self.provider, sandbox=True, error="Sandbox mode: no live provider configured, message not delivered")


class ResendSender:
    provider = "resend"

    def __init__(self, api_key: str, from_address: str, client: httpx.Client | None = None) -> None:
        self.api_key = api_key
        self.from_address = from_address
        self.http = client or httpx.Client(timeout=20)

    def _from(self, name: str | None) -> str:
        if not name:
            return self.from_address
        address = self.from_address.split("<")[-1].rstrip(">").strip()
        safe = name.replace('"', "").replace("\n", " ")[:70]
        return f'"{safe}" <{address}>'

    def send(self, message: OutboundMessage) -> SendResult:
        body = message.body
        headers: dict[str, str] = {}
        if message.unsubscribe_url:
            body += f"\n\n—\nTo stop receiving payment reminder emails: {message.unsubscribe_url}"
            headers = {"List-Unsubscribe": f"<{message.unsubscribe_url}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}
        payload = {"from": self._from(message.from_name), "to": [message.to], "subject": message.subject or "Payment reminder", "text": body, "headers": headers}
        if message.reply_to:
            payload["reply_to"] = message.reply_to
        try:
            response = self.http.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {self.api_key}", "Idempotency-Key": message.idempotency_key},
                json=payload,
            )
            response.raise_for_status()
            return SendResult(True, self.provider, message_id=str(response.json()["id"]))
        except (httpx.HTTPError, KeyError, ValueError) as exc:
            return _classify(self.provider, exc)


class WhatsAppCloudSender:
    """Official WhatsApp Business Platform (Cloud API). Business-initiated messages must use
    an approved template; the body parameters are filled from the invoice."""

    provider = "whatsapp"

    def __init__(self, access_token: str, phone_number_id: str, template_name: str, language: str, client: httpx.Client | None = None) -> None:
        self.access_token = access_token
        self.phone_number_id = phone_number_id
        self.template_name = template_name
        self.language = language
        self.http = client or httpx.Client(timeout=20)

    def send(self, message: OutboundMessage) -> SendResult:
        to = "".join(ch for ch in message.to if ch.isdigit())
        payload = {
            "messaging_product": "whatsapp", "to": to, "type": "template",
            "template": {
                "name": self.template_name, "language": {"code": self.language},
                "components": [{"type": "body", "parameters": [{"type": "text", "text": p} for p in message.template_params]}],
            },
        }
        try:
            response = self.http.post(
                f"https://graph.facebook.com/v21.0/{self.phone_number_id}/messages",
                headers={"Authorization": f"Bearer {self.access_token}"}, json=payload,
            )
            response.raise_for_status()
            return SendResult(True, self.provider, message_id=str(response.json()["messages"][0]["id"]))
        except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
            return _classify(self.provider, exc)


class TwilioSmsSender:
    provider = "twilio"

    def __init__(self, account_sid: str, auth_token: str, from_number: str, status_callback: str | None = None, client: httpx.Client | None = None) -> None:
        self.account_sid = account_sid
        self.auth_token = auth_token
        self.from_number = from_number
        self.status_callback = status_callback
        self.http = client or httpx.Client(timeout=20)

    def send(self, message: OutboundMessage) -> SendResult:
        data = {"To": message.to, "From": self.from_number, "Body": message.body[:1500]}
        if self.status_callback:
            data["StatusCallback"] = self.status_callback
        try:
            response = self.http.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{self.account_sid}/Messages.json",
                auth=(self.account_sid, self.auth_token), data=data,
            )
            response.raise_for_status()
            return SendResult(True, self.provider, message_id=str(response.json()["sid"]))
        except (httpx.HTTPError, KeyError, ValueError) as exc:
            return _classify(self.provider, exc)
