"""Pure-function tests: scheduling, formatting, AI validation, crypto, providers."""

from __future__ import annotations

import json
from datetime import UTC, datetime, time
from decimal import Decimal

import httpx
import pytest

from capflow_worker.ai import AIClient, AIError, ProviderConfig, ReminderDraft, parse_json_object, validate_reminder
from capflow_worker.crypto import decrypt_secret, encrypt_secret, unsubscribe_token
from capflow_worker.formatting import format_money, leftover_placeholders, render
from capflow_worker.providers import OutboundMessage, ResendSender, SandboxSender
from capflow_worker.scheduling import Step, WorkingHours, select_due_step

KEY = "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE="  # base64 of 32 ASCII bytes


# -- scheduling -------------------------------------------------------------
HOURS = WorkingHours("Asia/Kolkata", time(9), time(18), frozenset({1, 2, 3, 4, 5}))


def test_inside_working_hours_sends_now() -> None:
    moment = datetime(2026, 11, 16, 6, 0, tzinfo=UTC)  # Monday 11:30 IST
    assert HOURS.contains(moment) and HOURS.next_window(moment) == moment


def test_before_hours_waits_for_same_day_start() -> None:
    moment = datetime(2026, 11, 16, 1, 0, tzinfo=UTC)  # Monday 06:30 IST
    assert HOURS.next_window(moment) == datetime(2026, 11, 16, 3, 30, tzinfo=UTC)


def test_weekend_waits_for_monday() -> None:
    moment = datetime(2026, 11, 14, 10, 0, tzinfo=UTC)  # Saturday
    assert HOURS.next_window(moment) == datetime(2026, 11, 16, 3, 30, tzinfo=UTC)


def test_after_hours_friday_waits_for_monday() -> None:
    moment = datetime(2026, 11, 20, 13, 0, tzinfo=UTC)  # Friday 18:30 IST
    assert HOURS.next_window(moment) == datetime(2026, 11, 23, 3, 30, tzinfo=UTC)


STEPS = [Step("a", -5, "Upcoming", "send"), Step("b", 0, "Due", "send"), Step("c", 3, "Overdue 1", "send"), Step("d", 14, "Escalate", "escalate")]


def test_nothing_due_before_first_step() -> None:
    assert select_due_step(STEPS, -10, set()) == (None, [])


def test_only_latest_due_step_runs_and_earlier_ones_are_skipped() -> None:
    step, skipped = select_due_step(STEPS, 5, set())
    assert step and step.id == "c"
    assert [s.id for s in skipped] == ["a", "b"]


def test_completed_steps_never_run_again() -> None:
    assert select_due_step(STEPS, 5, {"a", "b", "c"}) == (None, [])


# -- formatting -------------------------------------------------------------
@pytest.mark.parametrize(("amount", "currency", "expected"), [
    ("1234567.5", "INR", "₹12,34,567.50"), ("1234567.5", "USD", "$1,234,567.50"), ("0.005", "GBP", "£0.01"), (Decimal("999"), "AED", "AED 999.00"),
])
def test_format_money(amount: str, currency: str, expected: str) -> None:
    assert format_money(amount, currency) == expected


def test_render_keeps_unknown_placeholders_visible() -> None:
    text = render("Hi {{customer_name}}, {{ invoice_number }} {{oops}}", {"customer_name": "Asha", "invoice_number": "INV-1"})
    assert text == "Hi Asha, INV-1 {{oops}}" and leftover_placeholders(text) == ["oops"]


# -- AI validation ----------------------------------------------------------
def draft(body: str, subject: str = "Invoice INV-7 reminder") -> ReminderDraft:
    return ReminderDraft(subject=subject, body=body)


GOOD = "Hello Asha,\n\nA friendly reminder that invoice INV-7 has ₹12,500.00 outstanding. Please let us know when we can expect payment.\n\nAcme"


def test_valid_draft_passes() -> None:
    assert validate_reminder(draft(GOOD), invoice_number="INV-7", amount="₹12,500.00")


@pytest.mark.parametrize("bad", [
    GOOD + " Otherwise we will take legal action.",
    GOOD + " This may affect your credit score.",
    GOOD + " Thank you for your payment.",
    GOOD + " A late fee of ₹500.00 applies.",
    GOOD + " Pay at https://evil.example",
    GOOD + " We may involve the police.",
    GOOD.replace("INV-7", "INV-8"),
    GOOD.replace("₹12,500.00", "₹12,000.00"),
    GOOD + " {{amount}}",
])
def test_unsafe_or_inaccurate_drafts_are_rejected(bad: str) -> None:
    with pytest.raises(AIError):
        validate_reminder(draft(bad, subject="Payment reminder"), invoice_number="INV-7", amount="₹12,500.00")


def test_json_extraction_handles_fences() -> None:
    assert parse_json_object('Sure!\n```json\n{"a": 1}\n```') == {"a": 1}
    with pytest.raises(AIError):
        parse_json_object("no json here")


def _client(handler: httpx.MockTransport, provider: str = "openrouter") -> AIClient:
    return AIClient(ProviderConfig(provider=provider, model="m", api_key="k"), transport=handler)


CONTEXT = {"invoice_number": "INV-7", "amount_outstanding": "₹12,500.00", "customer_name": "Asha"}


def test_openai_compatible_client_returns_validated_draft() -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/chat/completions")
        assert request.headers["authorization"] == "Bearer k"
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps({"subject": "Invoice INV-7", "body": GOOD})}}]})

    assert _client(httpx.MockTransport(respond)).draft_reminder(CONTEXT, "friendly").body == GOOD


def test_anthropic_client_and_unsafe_output_is_rejected() -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "api.anthropic.com"
        text = json.dumps({"subject": "Invoice INV-7", "body": GOOD + " We will sue you."})
        return httpx.Response(200, json={"content": [{"type": "text", "text": text}]})

    with pytest.raises(AIError, match="legal"):
        _client(httpx.MockTransport(respond), "anthropic").draft_reminder(CONTEXT, "firm")


def test_provider_outage_raises_ai_error() -> None:
    with pytest.raises(AIError, match="HTTP 503"):
        _client(httpx.MockTransport(lambda r: httpx.Response(503))).draft_reminder(CONTEXT, "firm")


# -- crypto -----------------------------------------------------------------
def test_secret_roundtrip_and_tamper_detection() -> None:
    sealed = encrypt_secret("sk-test-123", KEY)
    assert decrypt_secret(sealed, KEY) == "sk-test-123"
    tampered = sealed[:-4] + ("AAAA" if not sealed.endswith("AAAA") else "BBBB")
    with pytest.raises(Exception):  # noqa: B017 - any authentication failure
        decrypt_secret(tampered, KEY)


def test_unsubscribe_token_matches_web_app_format() -> None:
    # Same vector is asserted in src/lib/__tests__/crypto.test.ts.
    token = unsubscribe_token("8d0f6c1e-0000-4000-8000-000000000001", KEY)
    assert token == "8d0f6c1e-0000-4000-8000-000000000001.kl1DyC0mqRhBD8pxvHaJz2OeO7EHInD45eu8KpbNUWY"


def test_decrypts_secret_encrypted_by_the_web_app() -> None:
    # Produced by src/lib/crypto.ts encryptSecret("sk-from-node") with the same key.
    assert decrypt_secret("DQOhfB81GG5A6M5mcj+Omaevn69mx02OUkbP3xujVrqETyY7FR9xbQ==", KEY) == "sk-from-node"


# -- providers --------------------------------------------------------------
MSG = OutboundMessage(to="a@b.test", subject="S", body="Body", idempotency_key="reminder-1", from_name='Acme "Ltd"', unsubscribe_url="https://app/u/x")


def test_sandbox_never_reports_success() -> None:
    result = SandboxSender().send(MSG)
    assert not result.ok and result.sandbox


def test_resend_sends_idempotency_key_and_unsubscribe_header() -> None:
    seen: dict[str, object] = {}

    def respond(request: httpx.Request) -> httpx.Response:
        seen["headers"] = dict(request.headers)
        seen["json"] = json.loads(request.content)
        return httpx.Response(200, json={"id": "em_1"})

    result = ResendSender("key", "Capflow <r@capflow.test>", httpx.Client(transport=httpx.MockTransport(respond))).send(MSG)
    assert result.ok and result.message_id == "em_1"
    payload = seen["json"]
    assert isinstance(payload, dict)
    assert payload["from"] == '"Acme Ltd" <r@capflow.test>'
    assert payload["headers"]["List-Unsubscribe"] == "<https://app/u/x>"
    assert "https://app/u/x" in payload["text"]
    assert seen["headers"]["idempotency-key"] == "reminder-1"  # type: ignore[index]


@pytest.mark.parametrize(("status", "retryable"), [(500, True), (429, True), (422, False)])
def test_resend_errors_are_classified(status: int, retryable: bool) -> None:
    sender = ResendSender("key", "r@capflow.test", httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(status, text="err"))))
    result = sender.send(MSG)
    assert not result.ok and result.retryable is retryable
