"""Recovery engine: plans reminders from automation sequences and dispatches them.

Safety properties (each covered by tests):
  * A sequence step produces at most one reminder per invoice (unique dedupe_key).
  * Reminders are re-validated immediately before sending; anything that changed
    (paid, disputed, paused, promised, opted out) is cancelled, not sent.
  * A reminder is claimed with FOR UPDATE SKIP LOCKED, so concurrent workers never
    send it twice. A crash mid-send is marked failed for human review, never resent blindly.
  * Nothing is marked sent unless the provider accepted it. Sandbox attempts are
    recorded as not delivered.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, time, timedelta
from typing import Any

from psycopg.types.json import Jsonb

from .ai import AIClient, AIError, Tone
from .config import Settings
from .crypto import unsubscribe_token
from .db import Conn
from .formatting import format_date, format_money, render
from .integrations import ai_client, email_settings, sender_for
from .logging_setup import log
from .providers import OutboundMessage, Sender
from .scheduling import Step, WorkingHours, select_due_step

logger = logging.getLogger("capflow.recovery")


def _audit(conn: Conn, org: str, action: str, entity: str, entity_id: Any, invoice: Any, customer: Any, meta: dict[str, Any]) -> None:
    conn.execute("select app.audit(%s, %s, %s, %s, %s, %s, %s)", [org, action, entity, entity_id, invoice, customer, Jsonb(meta)])


def _hours(row: dict[str, Any]) -> WorkingHours:
    return WorkingHours(
        timezone=row["timezone"], start=row["working_hours_start"], end=row["working_hours_end"], days=frozenset(row["working_days"] or []),
    )


def _variables(row: dict[str, Any]) -> dict[str, str]:
    return {
        "customer_name": row["customer_name"],
        "invoice_number": row["invoice_number"],
        "amount_outstanding": format_money(row["amount_outstanding"], row["currency"]),
        "invoice_total": format_money(row["total"], row["currency"]),
        "due_date": format_date(row["due_date"]),
        "days_overdue": str(max(0, row["days_from_due"])),
        "organisation_name": row["org_name"],
        "payment_reference": row["payment_reference"] or row["invoice_number"],
    }


@dataclass
class PlanReport:
    planned: int = 0
    escalated: int = 0
    skipped: int = 0
    deferred: int = 0
    errors: list[str] = field(default_factory=list)


CANDIDATES = """
select i.id as invoice_id, i.organisation_id, i.customer_id, i.invoice_number, i.due_date, i.currency, i.total,
       i.amount_outstanding, i.payment_reference,
       c.name as customer_name, c.email, c.email_opt_out, c.phone, c.whatsapp_opt_in, c.sms_opt_in,
       o.name as org_name, o.timezone, o.billing_email,
       w.id as workflow_id, w.escalated_at,
       r.id as rule_id, r.approval_mode, r.use_ai, r.max_attempts, r.min_hours_between,
       r.working_hours_start, r.working_hours_end, r.working_days,
       (now() at time zone o.timezone)::date - i.due_date as days_from_due
from invoices i
join recovery_workflows w on w.invoice_id = i.id and w.status = 'active'
join customers c on c.id = i.customer_id
join organisations o on o.id = i.organisation_id and o.deleted_at is null
join automation_rules r on r.organisation_id = i.organisation_id and r.is_default and r.is_active
where i.status in ('sent', 'partially_paid') and i.archived_at is null and not i.recovery_paused
  and not exists (select 1 from payment_promises p where p.invoice_id = i.id and p.status = 'pending')
  and (%(org)s::uuid is null or i.organisation_id = %(org)s::uuid)
order by i.organisation_id, i.due_date
"""


def plan_reminders(
    conn: Conn,
    settings: Settings,
    *,
    org_id: str | None = None,
    now: datetime | None = None,
    ai_factory: Callable[[Conn, str], AIClient | None] | None = None,
) -> PlanReport:
    now = now or datetime.now(UTC)
    report = PlanReport()
    make_ai = ai_factory or (lambda c, org: ai_client(c, org, settings))
    entitlement_cache: dict[str, dict[str, Any]] = {}
    steps_cache: dict[str, list[dict[str, Any]]] = {}

    for row in conn.execute(CANDIDATES, {"org": org_id}).fetchall():
        org = str(row["organisation_id"])
        invoice = row["invoice_id"]
        if org not in entitlement_cache:
            ent = conn.execute("select app.entitlements(%s) as e, app.usage(%s) as u", [org, org]).fetchone()
            entitlement_cache[org] = {"e": ent["e"], "u": ent["u"]} if ent else {"e": {}, "u": {}}
        ent = entitlement_cache[org]["e"]
        if not ent.get("active"):
            report.deferred += 1
            continue

        rule_id = str(row["rule_id"])
        if rule_id not in steps_cache:
            steps_cache[rule_id] = conn.execute(
                "select s.*, t.subject as t_subject, t.body as t_body from automation_rule_steps s "
                "left join communication_templates t on t.id = s.template_id where s.rule_id = %s order by offset_days",
                [rule_id],
            ).fetchall()
        steps = steps_cache[rule_id]
        done = {
            r["step_id"] and str(r["step_id"])
            for r in conn.execute("select step_id from reminders where invoice_id = %s and step_id is not null", [invoice]).fetchall()
        }
        if row["escalated_at"] is not None:
            done |= {str(s["id"]) for s in steps if s["action"] == "escalate"}

        step, earlier = select_due_step(
            [Step(str(s["id"]), s["offset_days"], s["stage"], s["action"]) for s in steps], row["days_from_due"], done,
        )
        if step is None:
            continue
        spec = next(s for s in steps if str(s["id"]) == step.id)

        # Earlier steps that were never run are recorded as skipped so they can never fire later.
        for e in earlier:
            espec = next(s for s in steps if str(s["id"]) == e.id)
            if espec["action"] == "send":
                conn.execute(
                    """insert into reminders (organisation_id, invoice_id, customer_id, workflow_id, step_id, step_offset_days, stage,
                         channel, tone, subject, body, generated_by, status, last_error, dedupe_key)
                       values (%s, %s, %s, %s, %s, %s, %s, %s, %s, null, '(not generated)', 'template', 'skipped',
                         'Superseded by a later step', %s) on conflict (dedupe_key) do nothing""",
                    [org, invoice, row["customer_id"], row["workflow_id"], e.id, e.offset_days, e.stage, espec["channel"], espec["tone"], f"step:{e.id}:{invoice}"],
                )

        if step.action == "escalate":
            conn.execute(
                "update recovery_workflows set status = 'escalated', escalated_at = now(), status_reason = %s where id = %s",
                [f"{step.stage}: {row['days_from_due']} days overdue", row["workflow_id"]],
            )
            _audit(conn, org, "recovery.escalated", "invoice", invoice, invoice, row["customer_id"], {"stage": step.stage})
            conn.execute(
                "select app.notify_roles(%s, 'finance_manager', 'escalation', %s, %s, %s)",
                [org, f"Invoice {row['invoice_number']} needs attention",
                 f"{row['customer_name']} is {row['days_from_due']} days overdue on {format_money(row['amount_outstanding'], row['currency'])}.",
                 f"/invoices/{invoice}"],
            )
            report.escalated += 1
            continue

        # Send step: enforce limits before drafting.
        sent_or_pending = conn.execute(
            "select count(*) as n, max(sent_at) as last from reminders where invoice_id = %s and status in ('pending_approval','scheduled','sending','sent')",
            [invoice],
        ).fetchone()
        assert sent_or_pending is not None
        if sent_or_pending["n"] >= row["max_attempts"]:
            report.skipped += 1
            continue
        if sent_or_pending["last"] and sent_or_pending["last"] > now - timedelta(hours=row["min_hours_between"]):
            report.deferred += 1
            continue
        limit = (ent.get("limits") or {}).get("max_reminders_per_month")
        used = int(entitlement_cache[org]["u"].get("reminders_this_month", 0))
        if limit is not None and used >= int(limit):
            report.deferred += 1
            continue

        channel = spec["channel"]
        dedupe = f"step:{step.id}:{invoice}"
        reason = None
        if channel == "email" and (not row["email"] or row["email_opt_out"]):
            reason = "Customer has no billing email" if not row["email"] else "Customer opted out of email"
        if channel in ("whatsapp", "sms") and (not row["phone"] or not row[f"{channel}_opt_in"]):
            reason = f"Customer has not opted in to {channel}"
        if reason:
            conn.execute(
                """insert into reminders (organisation_id, invoice_id, customer_id, workflow_id, step_id, step_offset_days, stage, channel, tone,
                     body, generated_by, status, last_error, dedupe_key)
                   values (%s,%s,%s,%s,%s,%s,%s,%s,%s,'(not generated)','template','skipped',%s,%s) on conflict (dedupe_key) do nothing""",
                [org, invoice, row["customer_id"], row["workflow_id"], step.id, step.offset_days, step.stage, channel, spec["tone"], reason, dedupe],
            )
            report.skipped += 1
            continue

        variables = _variables(row)
        subject = render(spec["t_subject"] or "Payment reminder: invoice {{invoice_number}}", variables)
        body = render(spec["t_body"] or "Hello {{customer_name}},\n\nInvoice {{invoice_number}} has {{amount_outstanding}} outstanding.\n\n{{organisation_name}}", variables)
        generated_by, model = "template", None

        if row["use_ai"] and (ent.get("limits") or {}).get("ai_reminders"):
            client = make_ai(conn, org)
            if client is not None:
                try:
                    draft = client.draft_reminder(_ai_context(conn, row, variables), spec["tone"])
                    subject, body, generated_by, model = draft.subject, draft.body, "ai", client.config.model
                except AIError as exc:
                    log(logger, logging.WARNING, "ai draft rejected, using template", invoice=str(invoice), error=str(exc))

        auto = row["approval_mode"] == "auto"
        scheduled_for = _hours(row).next_window(now) if auto else now
        inserted = conn.execute(
            """insert into reminders (organisation_id, invoice_id, customer_id, workflow_id, step_id, step_offset_days, stage, channel, tone,
                 subject, body, generated_by, ai_model, status, scheduled_for, dedupe_key)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) on conflict (dedupe_key) do nothing returning id""",
            [org, invoice, row["customer_id"], row["workflow_id"], step.id, step.offset_days, step.stage, channel, spec["tone"],
             subject, body, generated_by, model, "scheduled" if auto else "pending_approval", scheduled_for, dedupe],
        ).fetchone()
        if inserted:
            _audit(conn, org, "reminder.planned", "reminder", inserted["id"], invoice, row["customer_id"],
                   {"stage": step.stage, "mode": "auto" if auto else "manual", "generated_by": generated_by})
            entitlement_cache[org]["u"]["reminders_this_month"] = used + 1
            report.planned += 1
            if not auto:
                conn.execute(
                    "select app.notify_roles(%s, 'finance_manager', 'approval', %s, %s, '/recovery')",
                    [org, f"Reminder ready for approval: {row['invoice_number']}", f"{step.stage} for {row['customer_name']}"],
                )
    return report


def _ai_context(conn: Conn, row: dict[str, Any], variables: dict[str, str]) -> dict[str, Any]:
    history = conn.execute(
        """select count(*) filter (where status = 'paid') as paid_invoices,
                  round(avg(greatest(0, paid_on - due_date)) filter (where status = 'paid'), 0) as avg_days_late,
                  count(*) filter (where status in ('sent','partially_paid') and due_date < current_date) as other_overdue
           from invoices where customer_id = %s and id <> %s and archived_at is null""",
        [row["customer_id"], row["invoice_id"]],
    ).fetchone() or {}
    broken = conn.execute("select count(*) as n from payment_promises where customer_id = %s and status = 'broken'", [row["customer_id"]]).fetchone()
    previous = conn.execute("select count(*) as n from reminders where invoice_id = %s and status = 'sent'", [row["invoice_id"]]).fetchone()
    return {
        **variables,
        "days_relative_to_due": row["days_from_due"],
        "reminders_already_sent_for_this_invoice": previous["n"] if previous else 0,
        "customer_history": {
            "paid_invoices": history.get("paid_invoices"),
            "average_days_late": float(history["avg_days_late"]) if history.get("avg_days_late") is not None else None,
            "other_overdue_invoices": history.get("other_overdue"),
            "broken_payment_promises": broken["n"] if broken else 0,
        },
    }


def redraft_with_ai(conn: Conn, settings: Settings, reminder_id: str, tone: Tone, client: AIClient | None = None) -> str:
    """Background job: rewrites a reminder awaiting approval. Raises AIError on failure (the job records it)."""
    row = conn.execute(
        """select r.id, r.status, r.organisation_id, i.id as invoice_id, i.customer_id, i.invoice_number, i.due_date, i.currency,
                  i.total, i.amount_outstanding, i.payment_reference, c.name as customer_name, o.name as org_name, o.timezone,
                  (now() at time zone o.timezone)::date - i.due_date as days_from_due
           from reminders r join invoices i on i.id = r.invoice_id join customers c on c.id = i.customer_id
           join organisations o on o.id = r.organisation_id where r.id = %s for update of r""",
        [reminder_id],
    ).fetchone()
    if not row:
        raise AIError("reminder not found")
    if row["status"] != "pending_approval":
        raise AIError("reminder is no longer awaiting approval")
    client = client or ai_client(conn, str(row["organisation_id"]), settings)
    if client is None:
        raise AIError("AI integration is not configured")
    variables = _variables(row)
    draft = client.draft_reminder(_ai_context(conn, row, variables), tone)
    conn.execute(
        "update reminders set subject = %s, body = %s, tone = %s, generated_by = 'ai', ai_model = %s where id = %s and status = 'pending_approval'",
        [draft.subject, draft.body, tone, client.config.model, reminder_id],
    )
    return client.config.model


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

@dataclass
class DispatchReport:
    sent: int = 0
    sandbox: int = 0
    cancelled: int = 0
    rescheduled: int = 0
    retried: int = 0
    failed: int = 0


CLAIM = """
update reminders set status = 'sending', attempts = attempts + 1
where id in (
  select id from reminders where status = 'scheduled' and scheduled_for <= %(now)s
    and (%(org)s::uuid is null or organisation_id = %(org)s::uuid)
  order by scheduled_for limit %(limit)s for update skip locked)
returning id
"""

CONTEXT = """
select r.*, i.status as invoice_status, i.archived_at, i.recovery_paused, i.invoice_number, i.amount_outstanding, i.currency, i.due_date,
       c.email, c.email_opt_out, c.phone, c.whatsapp_opt_in, c.sms_opt_in, c.name as customer_name,
       o.name as org_name, o.timezone, o.billing_email, o.deleted_at,
       ru.working_hours_start, ru.working_hours_end, ru.working_days,
       exists (select 1 from payment_promises p where p.invoice_id = i.id and p.status = 'pending') as has_promise,
       (app.entitlements(r.organisation_id) ->> 'active')::boolean as subscription_active
from reminders r
join invoices i on i.id = r.invoice_id
join customers c on c.id = r.customer_id
join organisations o on o.id = r.organisation_id
left join automation_rules ru on ru.organisation_id = r.organisation_id and ru.is_default
where r.id = %s
"""


def _blocker(ctx: dict[str, Any]) -> str | None:
    if ctx["deleted_at"] is not None:
        return "Organisation deleted"
    if ctx["invoice_status"] == "paid":
        return "Invoice was paid before sending"
    if ctx["invoice_status"] == "disputed":
        return "Invoice is disputed"
    if ctx["invoice_status"] not in ("sent", "partially_paid") or ctx["archived_at"] is not None:
        return "Invoice is no longer open"
    if ctx["recovery_paused"]:
        return "Recovery is paused for this invoice"
    if ctx["has_promise"]:
        return "A payment promise is pending"
    channel = ctx["channel"]
    if channel == "email" and (not ctx["email"] or ctx["email_opt_out"]):
        return "Customer opted out of email" if ctx["email"] else "Customer has no billing email"
    if channel in ("whatsapp", "sms") and (not ctx["phone"] or not ctx[f"{channel}_opt_in"]):
        return f"Customer has not opted in to {channel}"
    return None


def _finish(conn: Conn, reminder_id: Any, status: str, error: str | None = None, sent: bool = False) -> None:
    conn.execute(
        "update reminders set status = %s, last_error = %s, sent_at = case when %s then now() else sent_at end where id = %s",
        [status, error, sent, reminder_id],
    )


def dispatch_due(
    conn: Conn,
    settings: Settings,
    *,
    org_id: str | None = None,
    now: datetime | None = None,
    sender_factory: Callable[[Conn, str, str], Sender] | None = None,
    commit: Callable[[], None] | None = None,
) -> DispatchReport:
    now = now or datetime.now(UTC)
    checkpoint = commit or conn.commit
    report = DispatchReport()
    make_sender = sender_factory or (lambda c, org, channel: sender_for(c, org, channel, settings))
    claimed = [r["id"] for r in conn.execute(CLAIM, {"now": now, "org": org_id, "limit": settings.dispatch_batch_size}).fetchall()]
    # Persist the claim before any network call so a concurrent worker cannot pick the same rows.
    checkpoint()

    for reminder_id in claimed:
        ctx = conn.execute(CONTEXT, [reminder_id]).fetchone()
        if ctx is None:
            continue
        org = str(ctx["organisation_id"])
        blocker = _blocker(ctx)
        if blocker:
            _finish(conn, reminder_id, "cancelled", blocker)
            report.cancelled += 1
            checkpoint()
            continue
        if not ctx["subscription_active"]:
            conn.execute("update reminders set status = 'scheduled', scheduled_for = %s, last_error = 'Subscription inactive' where id = %s",
                         [now + timedelta(hours=6), reminder_id])
            report.rescheduled += 1
            checkpoint()
            continue
        if ctx["working_days"]:
            hours = WorkingHours(ctx["timezone"], ctx["working_hours_start"] or time(9), ctx["working_hours_end"] or time(18), frozenset(ctx["working_days"]))
            if not hours.contains(now):
                conn.execute("update reminders set status = 'scheduled', scheduled_for = %s, attempts = attempts - 1 where id = %s",
                             [hours.next_window(now), reminder_id])
                report.rescheduled += 1
                checkpoint()
                continue

        channel = ctx["channel"]
        to = ctx["email"] if channel == "email" else ctx["phone"]
        unsubscribe = None
        if channel == "email" and settings.app_encryption_key:
            unsubscribe = f"{settings.app_url}/u/{unsubscribe_token(str(ctx['customer_id']), settings.app_encryption_key)}"
        prefs = email_settings(conn, org) if channel == "email" else {}
        message = OutboundMessage(
            to=to, subject=ctx["subject"], body=ctx["body"], idempotency_key=f"reminder-{reminder_id}",
            from_name=prefs.get("from_name") or ctx["org_name"], reply_to=prefs.get("reply_to") or ctx["billing_email"],
            unsubscribe_url=unsubscribe,
            template_params=(ctx["customer_name"], ctx["invoice_number"], format_money(ctx["amount_outstanding"], ctx["currency"]), format_date(ctx["due_date"])),
        )
        sender = make_sender(conn, org, channel)
        result = sender.send(message)

        conn.execute(
            """insert into communication_logs (organisation_id, customer_id, invoice_id, reminder_id, channel, provider, sandbox,
                 provider_message_id, to_address, subject, body, status, error)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            [org, ctx["customer_id"], ctx["invoice_id"], reminder_id, channel, result.provider, result.sandbox, result.message_id,
             to, ctx["subject"], ctx["body"], "sent" if result.ok else ("sandbox" if result.sandbox else "failed"), result.error],
        )
        if result.ok:
            _finish(conn, reminder_id, "sent", sent=True)
            conn.execute("update recovery_workflows set attempts_count = attempts_count + 1, last_action_at = now() where invoice_id = %s", [ctx["invoice_id"]])
            report.sent += 1
        elif result.sandbox:
            _finish(conn, reminder_id, "skipped", result.error)
            _audit(conn, org, "reminder.sandbox", "reminder", reminder_id, ctx["invoice_id"], ctx["customer_id"], {"stage": ctx["stage"], "channel": channel})
            report.sandbox += 1
        elif result.retryable and ctx["attempts"] < settings.max_send_attempts:
            backoff = timedelta(minutes=5 * (2 ** (ctx["attempts"] - 1)))
            conn.execute("update reminders set status = 'scheduled', scheduled_for = %s, last_error = %s where id = %s", [now + backoff, result.error, reminder_id])
            report.retried += 1
        else:
            _finish(conn, reminder_id, "failed", result.error)
            conn.execute(
                "select app.notify_roles(%s, 'finance_manager', 'delivery_failed', %s, %s, '/recovery?tab=attention')",
                [org, f"Reminder for {ctx['invoice_number']} could not be delivered", (result.error or "")[:200]],
            )
            report.failed += 1
        log(logger, logging.INFO, "reminder dispatched", reminder=str(reminder_id), ok=result.ok, sandbox=result.sandbox, provider=result.provider)
        checkpoint()
    return report


def recover_stuck(conn: Conn, *, now: datetime | None = None, minutes: int = 15) -> int:
    """Reminders left in 'sending' by a crashed worker. Delivery is unknown, so a person must decide; never resent automatically."""
    now = now or datetime.now(UTC)
    rows = conn.execute(
        """update reminders set status = 'failed', last_error = 'Worker stopped while sending; delivery unknown. Check the provider log before retrying.'
           where status = 'sending' and updated_at < %s returning id""",
        [now - timedelta(minutes=minutes)],
    ).fetchall()
    return len(rows)


def mark_broken_promises(conn: Conn) -> int:
    row = conn.execute("select app.mark_broken_promises() as n").fetchone()
    return int(row["n"]) if row else 0
