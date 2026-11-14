"""Recovery engine against a real database: planning, dispatch, safeguards, jobs and webhooks."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from capflow_worker.ai import AIClient, AIError, ProviderConfig, ReminderDraft
from capflow_worker.config import Settings
from capflow_worker.jobs import run_jobs
from capflow_worker.providers import OutboundMessage, SandboxSender, SendResult
from capflow_worker.recovery import dispatch_due, plan_reminders, recover_stuck

from .conftest import Db

pytestmark = pytest.mark.db

KEY = "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE="
SETTINGS = Settings(app_encryption_key=KEY, app_url="https://app.test", max_send_attempts=3)
# A Monday, 11:30 in Asia/Kolkata: inside the default working hours.
WORK_TIME = datetime(2026, 11, 16, 6, 0, tzinfo=UTC)
NO_COMMIT: Any = lambda: None  # noqa: E731 - keep the test transaction open so it rolls back


class FakeSender:
    provider = "fake"

    def __init__(self, *results: SendResult) -> None:
        self.results = list(results) or [SendResult(True, "fake", message_id=str(uuid.uuid4()))]
        self.sent: list[OutboundMessage] = []

    def send(self, message: OutboundMessage) -> SendResult:
        self.sent.append(message)
        return self.results.pop(0) if len(self.results) > 1 else self.results[0]


def no_ai(_conn: Any, _org: str) -> None:
    return None


@pytest.fixture
def setup(db: Db) -> dict[str, Any]:
    owner = db.user()
    org = db.org(owner)
    customer = db.customer(org)
    db.system()
    return {"org": org, "customer": customer, "owner": owner}


def plan(db: Db, org: Any, **kw: Any) -> Any:
    db.system()
    return plan_reminders(db.conn, SETTINGS, org_id=str(org), now=WORK_TIME, ai_factory=kw.pop("ai", no_ai), **kw)


def dispatch(db: Db, org: Any, sender: Any, now: datetime = WORK_TIME) -> Any:
    db.system()
    return dispatch_due(db.conn, SETTINGS, org_id=str(org), now=now, sender_factory=lambda c, o, ch: sender, commit=NO_COMMIT)


def reminders(db: Db, invoice: Any) -> list[dict[str, Any]]:
    return db.all("select * from reminders where invoice_id = %s order by step_offset_days nulls last", [invoice])


def test_plans_only_the_latest_due_step_once(db: Db, setup: dict[str, Any]) -> None:
    invoice = db.invoice(setup["org"], setup["customer"], due_in_days=-4)
    report = plan(db, setup["org"])
    assert report.planned == 1
    rows = reminders(db, invoice)
    assert [(r["stage"], r["status"]) for r in rows] == [
        ("Upcoming payment reminder", "skipped"), ("Payment due today", "skipped"), ("First overdue reminder", "pending_approval"),
    ]
    pending = rows[-1]
    assert "{{" not in pending["body"] and "₹1,180.00" in pending["body"]
    assert plan(db, setup["org"]).planned == 0, "running the planner again must not create duplicates"
    assert len(reminders(db, invoice)) == 3
    assert db.val("select count(*) from notifications where kind = 'approval'") == 1


def test_not_yet_due_invoice_gets_no_reminder(db: Db, setup: dict[str, Any]) -> None:
    invoice = db.invoice(setup["org"], setup["customer"], due_in_days=20)
    plan(db, setup["org"])
    assert reminders(db, invoice) == []


@pytest.mark.parametrize("state", ["disputed", "paused", "promised", "draft", "paid"])
def test_blocked_invoices_are_never_planned(db: Db, setup: dict[str, Any], state: str) -> None:
    org, customer, owner = setup["org"], setup["customer"], setup["owner"]
    db.login(owner)
    invoice = db.invoice(org, customer, due_in_days=-4, send=state != "draft")
    if state == "disputed":
        db.run("update invoices set status = 'disputed', dispute_reason = 'x' where id = %s", [invoice])
    elif state == "paused":
        db.run("update invoices set recovery_paused = true where id = %s", [invoice])
    elif state == "promised":
        db.run("insert into payment_promises (organisation_id, invoice_id, customer_id, promised_amount, promised_date) values (%s,%s,%s,100,current_date+3)", [org, invoice, customer])
    elif state == "paid":
        db.pay(org, customer, "1180.00", [(invoice, "1180.00")])
    plan(db, org)
    assert [r for r in reminders(db, invoice) if r["status"] != "skipped"] == []


def test_auto_mode_sends_and_records_delivery(db: Db, setup: dict[str, Any]) -> None:
    org = setup["org"]
    db.run("update automation_rules set approval_mode = 'auto' where organisation_id = %s", [org])
    invoice = db.invoice(org, setup["customer"], due_in_days=-4)
    plan(db, org)
    assert reminders(db, invoice)[-1]["status"] == "scheduled"

    sender = FakeSender()
    report = dispatch(db, org, sender)
    assert report.sent == 1 and len(sender.sent) == 1
    message = sender.sent[0]
    assert message.idempotency_key.startswith("reminder-") and message.unsubscribe_url and message.unsubscribe_url.startswith("https://app.test/u/")
    row = reminders(db, invoice)[-1]
    assert row["status"] == "sent" and row["sent_at"] is not None
    log = db.one("select * from communication_logs where reminder_id = %s", [row["id"]])
    assert (log["status"], log["sandbox"], log["provider"]) == ("sent", False, "fake")
    assert db.val("select attempts_count from recovery_workflows where invoice_id = %s", [invoice]) == 1
    assert db.val("select count(*) from audit_logs where invoice_id = %s and action = 'reminder.sent'", [invoice]) == 1

    assert dispatch(db, org, sender).sent == 0 and len(sender.sent) == 1, "a sent reminder is never sent again"


def test_sandbox_mode_never_marks_a_reminder_sent(db: Db, setup: dict[str, Any]) -> None:
    org = setup["org"]
    db.run("update automation_rules set approval_mode = 'auto' where organisation_id = %s", [org])
    invoice = db.invoice(org, setup["customer"], due_in_days=-4)
    plan(db, org)
    report = dispatch(db, org, SandboxSender("resend"))
    assert report.sandbox == 1 and report.sent == 0
    row = reminders(db, invoice)[-1]
    assert row["status"] == "skipped" and "not delivered" in row["last_error"]
    assert db.val("select status from communication_logs where reminder_id = %s", [row["id"]]) == "sandbox"


def test_state_is_rechecked_at_send_time(db: Db, setup: dict[str, Any]) -> None:
    org, customer = setup["org"], setup["customer"]
    db.run("update automation_rules set approval_mode = 'auto' where organisation_id = %s", [org])
    invoice = db.invoice(org, customer, due_in_days=-4)
    plan(db, org)
    db.run("update customers set email_opt_out = true where id = %s", [customer])
    sender = FakeSender()
    assert dispatch(db, org, sender).cancelled == 1 and sender.sent == []
    assert reminders(db, invoice)[-1]["last_error"] == "Customer opted out of email"


def test_payment_before_sending_cancels_the_reminder(db: Db, setup: dict[str, Any]) -> None:
    org, customer = setup["org"], setup["customer"]
    db.run("update automation_rules set approval_mode = 'auto' where organisation_id = %s", [org])
    invoice = db.invoice(org, customer, due_in_days=-4)
    plan(db, org)
    db.login(setup["owner"])
    db.pay(org, customer, "1180.00", [(invoice, "1180.00")])
    sender = FakeSender()
    dispatch(db, org, sender)
    assert sender.sent == [] and reminders(db, invoice)[-1]["status"] == "cancelled"


def test_manual_approval_then_send(db: Db, setup: dict[str, Any]) -> None:
    org = setup["org"]
    invoice = db.invoice(org, setup["customer"], due_in_days=-4)
    plan(db, org)
    pending = reminders(db, invoice)[-1]
    sender = FakeSender()
    assert dispatch(db, org, sender).sent == 0, "unapproved reminders are never sent"
    db.login(setup["owner"])
    db.run("update reminders set status = 'scheduled' where id = %s", [pending["id"]])
    assert db.val("select approved_by from reminders where id = %s", [pending["id"]]) == setup["owner"]
    db.run("update reminders set scheduled_for = %s where id = %s", [WORK_TIME, pending["id"]])
    assert dispatch(db, org, sender).sent == 1


def test_transient_failures_retry_then_fail_visibly(db: Db, setup: dict[str, Any]) -> None:
    org = setup["org"]
    db.run("update automation_rules set approval_mode = 'auto' where organisation_id = %s", [org])
    invoice = db.invoice(org, setup["customer"], due_in_days=-4)
    plan(db, org)
    sender = FakeSender(SendResult(False, "fake", error="HTTP 503", retryable=True))
    now = WORK_TIME
    for attempt in range(1, 4):
        dispatch(db, org, sender, now)
        row = reminders(db, invoice)[-1]
        assert row["attempts"] == attempt
        now = row["scheduled_for"] + timedelta(seconds=1)
        if attempt < 3:
            assert row["status"] == "scheduled" and row["scheduled_for"] > WORK_TIME
    row = reminders(db, invoice)[-1]
    assert row["status"] == "failed" and row["last_error"] == "HTTP 503"
    assert db.val("select count(*) from notifications where kind = 'delivery_failed'") >= 1


def test_permanent_failure_is_not_retried(db: Db, setup: dict[str, Any]) -> None:
    org = setup["org"]
    db.run("update automation_rules set approval_mode = 'auto' where organisation_id = %s", [org])
    invoice = db.invoice(org, setup["customer"], due_in_days=-4)
    plan(db, org)
    dispatch(db, org, FakeSender(SendResult(False, "fake", error="HTTP 422 invalid address", retryable=False)))
    assert reminders(db, invoice)[-1]["status"] == "failed"


def test_outside_working_hours_waits(db: Db, setup: dict[str, Any]) -> None:
    org = setup["org"]
    db.run("update automation_rules set approval_mode = 'auto' where organisation_id = %s", [org])
    invoice = db.invoice(org, setup["customer"], due_in_days=-4)
    plan(db, org)
    sunday = datetime(2026, 11, 22, 6, 0, tzinfo=UTC)
    sender = FakeSender()
    assert dispatch(db, org, sender, sunday).rescheduled == 1 and sender.sent == []
    row = reminders(db, invoice)[-1]
    assert row["status"] == "scheduled" and row["scheduled_for"] == datetime(2026, 11, 23, 3, 30, tzinfo=UTC)


def test_interrupted_send_is_flagged_not_resent(db: Db, setup: dict[str, Any]) -> None:
    org = setup["org"]
    invoice = db.invoice(org, setup["customer"], due_in_days=-4)
    plan(db, org)
    db.run("update reminders set status = 'sending' where invoice_id = %s and status = 'pending_approval'", [invoice])
    assert recover_stuck(db.conn, now=datetime.now(UTC) + timedelta(hours=1)) == 1
    row = reminders(db, invoice)[-1]
    assert row["status"] == "failed" and "delivery unknown" in row["last_error"]


def test_escalation_happens_once_and_sends_nothing(db: Db, setup: dict[str, Any]) -> None:
    org = setup["org"]
    invoice = db.invoice(org, setup["customer"], due_in_days=-20, issue_days_ago=50)
    report = plan(db, org)
    assert report.escalated == 1 and report.planned == 0
    assert db.val("select status from recovery_workflows where invoice_id = %s", [invoice]) == "escalated"
    assert all(r["status"] == "skipped" for r in reminders(db, invoice))
    notified = db.val("select count(*) from notifications where kind = 'escalation'")
    assert notified == 1
    db.run("update recovery_workflows set status = 'active' where invoice_id = %s", [invoice])  # finance manager clears it
    assert plan(db, org).escalated == 0
    assert db.val("select count(*) from notifications where kind = 'escalation'") == notified


def test_max_attempts_is_respected(db: Db, setup: dict[str, Any]) -> None:
    org = setup["org"]
    db.run("update automation_rules set max_attempts = 1 where organisation_id = %s", [org])
    invoice = db.invoice(org, setup["customer"], due_in_days=-4)
    plan(db, org)
    db.run("update reminders set status = 'sent', sent_at = now() - interval '10 days' where invoice_id = %s and status = 'pending_approval'", [invoice])
    db.run("update recovery_workflows set status = 'active' where invoice_id = %s", [invoice])
    db.run("delete from automation_rule_steps where offset_days = 3")
    assert plan(db, org).planned == 0


def test_expired_subscription_defers_planning(db: Db, setup: dict[str, Any]) -> None:
    org = setup["org"]
    invoice = db.invoice(org, setup["customer"], due_in_days=-4)
    db.run("update subscriptions set trial_ends_at = now() - interval '1 day' where organisation_id = %s", [org])
    assert plan(db, org).deferred >= 1 and reminders(db, invoice) == []


class StubAI(AIClient):
    def __init__(self, behaviour: str) -> None:
        super().__init__(ProviderConfig("openrouter", "stub-model", "k"))
        self.behaviour = behaviour

    def draft_reminder(self, context: dict[str, Any], tone: Any) -> ReminderDraft:
        if self.behaviour == "fail":
            raise AIError("draft rejected: contains legal threats")
        return ReminderDraft(subject=f"About invoice {context['invoice_number']}",
                             body=f"Hi {context['customer_name']}, invoice {context['invoice_number']} still shows {context['amount_outstanding']} due. Could you share an expected payment date?")


@pytest.mark.parametrize(("behaviour", "expected"), [("ok", "ai"), ("fail", "template")])
def test_ai_personalisation_with_template_fallback(db: Db, setup: dict[str, Any], behaviour: str, expected: str) -> None:
    org = setup["org"]
    db.run("update automation_rules set use_ai = true where organisation_id = %s", [org])
    invoice = db.invoice(org, setup["customer"], due_in_days=-4)
    plan(db, org, ai=lambda c, o: StubAI(behaviour))
    row = reminders(db, invoice)[-1]
    assert row["generated_by"] == expected and row["status"] == "pending_approval"
    assert (row["ai_model"] == "stub-model") is (expected == "ai")


def test_job_queue_retries_then_dead_letters(db: Db, setup: dict[str, Any]) -> None:
    org = setup["org"]
    db.run("insert into background_jobs (organisation_id, job_type, payload, max_attempts) values (%s, 'flaky', '{}', 2)", [org])
    db.run("insert into background_jobs (organisation_id, job_type, payload) values (%s, 'ok', '{}')", [org])

    def flaky(*_: Any) -> dict[str, Any]:
        raise RuntimeError("provider timeout")

    handlers = {"flaky": flaky, "ok": lambda *_: {"done": True}}
    now = datetime.now(UTC)
    first = run_jobs(db.conn, SETTINGS, handlers=handlers, now=now, commit=NO_COMMIT)
    assert first == {"succeeded": 1, "retrying": 1, "dead": 0}
    second = run_jobs(db.conn, SETTINGS, handlers=handlers, now=now + timedelta(hours=1), commit=NO_COMMIT)
    assert second["dead"] == 1
    job = db.one("select status, attempts, last_error from background_jobs where job_type = 'flaky'")
    assert (job["status"], job["attempts"], job["last_error"]) == ("dead", 2, "provider timeout")
    assert db.val("select result from background_jobs where job_type = 'ok'") == {"done": True}


def test_ai_redraft_job_requires_configuration(db: Db, setup: dict[str, Any]) -> None:
    org = setup["org"]
    invoice = db.invoice(org, setup["customer"], due_in_days=-4)
    plan(db, org)
    reminder = reminders(db, invoice)[-1]["id"]
    db.run("insert into background_jobs (organisation_id, job_type, payload) values (%s, 'ai_draft_reminder', %s)",
           [org, f'{{"reminder_id": "{reminder}", "tone": "firm"}}'])
    run_jobs(db.conn, SETTINGS, commit=NO_COMMIT)
    job = db.one("select status, last_error from background_jobs where job_type = 'ai_draft_reminder'")
    assert job["status"] == "failed" and "not configured" in job["last_error"]
    assert reminders(db, invoice)[-1]["generated_by"] == "template"


def test_delivery_webhooks_only_move_forward_and_complaints_opt_out(db: Db, setup: dict[str, Any]) -> None:
    org, customer = setup["org"], setup["customer"]
    db.run("update automation_rules set approval_mode = 'auto' where organisation_id = %s", [org])
    invoice = db.invoice(org, customer, due_in_days=-4)
    plan(db, org)
    dispatch(db, org, FakeSender(SendResult(True, "resend", message_id="em_42")))
    assert db.val("select apply_delivery_status('resend', 'em_42', 'delivered', null)") is True
    db.val("select apply_delivery_status('resend', 'em_42', 'sent', null)")
    assert db.val("select status from communication_logs where provider_message_id = 'em_42'") == "delivered"
    db.val("select apply_delivery_status('resend', 'em_42', 'complained', null)")
    assert db.val("select email_opt_out from customers where id = %s", [customer]) is True
    assert db.val("select apply_delivery_status('resend', 'unknown', 'delivered', null)") is False
    _ = invoice


def test_subscription_webhook_update_and_access(db: Db, setup: dict[str, Any]) -> None:
    org = setup["org"]
    db.run("select apply_subscription_update(%s, 'business', 'active', 'annual', 'stripe', 'cus_1', 'sub_1', now(), now() + interval '1 year', false)", [org])
    sub = db.one("select * from subscriptions where organisation_id = %s", [org])
    assert (sub["plan_id"], sub["status"], sub["provider_subscription_id"], sub["trial_ends_at"]) == ("business", "active", "sub_1", None)
    db.run("select apply_subscription_update(%s, null, 'past_due', null, 'stripe', null, null, null, null, null)", [org])
    assert db.val("select plan_id from subscriptions where organisation_id = %s", [org]) == "business"
    assert db.val("select count(*) from notifications where kind = 'billing'") == 1
    db.login(setup["owner"])
    with db.expect_error("permission denied"):
        db.run("select apply_subscription_update(%s, 'enterprise', 'active', null, null, null, null, null, null, null)", [org])
