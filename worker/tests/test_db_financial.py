"""Invoice maths, payments, reconciliation, promises and plan limits."""

from __future__ import annotations

from decimal import Decimal

import pytest

from .conftest import Db

pytestmark = pytest.mark.db


def _invoice(db: Db, invoice_id) -> dict:
    return db.one("select * from invoice_ledger where id = %s", [invoice_id])


@pytest.fixture
def org(db: Db):
    owner = db.user()
    org_id = db.org(owner)
    customer = db.customer(org_id)
    return org_id, customer, owner


def test_totals_are_calculated_exactly_from_line_items(db: Db, org) -> None:
    org_id, customer, _ = org
    invoice = db.invoice(org_id, customer, items=[
        {"description": "Widgets", "quantity": "3", "unit_price": "199.99", "tax_rate": "18"},
        {"description": "Freight", "quantity": "1", "unit_price": "0.10", "tax_rate": "5"},
        {"description": "Imported line", "quantity": "1", "unit_price": "50.00", "tax_amount": "4.37"},
    ])
    row = _invoice(db, invoice)
    # 599.97 + 0.10 + 50.00 ; tax 107.99 (107.9946) + 0.01 (0.005 rounds half away from zero) + 4.37
    assert row["subtotal"] == Decimal("650.07")
    assert row["tax_total"] == Decimal("112.37")
    assert row["total"] == Decimal("762.44")
    assert row["amount_outstanding"] == Decimal("762.44")
    assert row["status"] == "sent"


def test_floating_point_trap_values_sum_exactly(db: Db, org) -> None:
    org_id, customer, _ = org
    invoice = db.invoice(org_id, customer, items=[
        {"description": "a", "quantity": "1", "unit_price": "0.10"},
        {"description": "b", "quantity": "1", "unit_price": "0.20"},
    ])
    assert _invoice(db, invoice)["total"] == Decimal("0.30")


def test_balances_and_paid_status_cannot_be_written_directly(db: Db, org) -> None:
    org_id, customer, _ = org
    invoice = db.invoice(org_id, customer)
    with db.expect_error("Record a payment instead"):
        db.run("update invoices set status = 'paid' where id = %s", [invoice])
    with db.expect_error("calculated from line items and payments"):
        db.run("update invoices set amount_paid = total where id = %s", [invoice])
    with db.expect_error("calculated from line items and payments"):
        db.run("update invoices set total = 1 where id = %s", [invoice])


def test_partial_then_full_payment(db: Db, org) -> None:
    org_id, customer, _ = org
    invoice = db.invoice(org_id, customer)  # 1180.00
    db.pay(org_id, customer, "500.00", [(invoice, "500.00")])
    row = _invoice(db, invoice)
    assert (row["status"], row["amount_paid"], row["amount_outstanding"]) == ("partially_paid", Decimal("500.00"), Decimal("680.00"))
    assert row["paid_on"] is None

    db.pay(org_id, customer, "680.00", [(invoice, "680.00")])
    row = _invoice(db, invoice)
    assert (row["status"], row["amount_outstanding"]) == ("paid", Decimal("0.00"))
    assert row["paid_on"] is not None
    assert db.val("select status from recovery_workflows where invoice_id = %s", [invoice]) == "completed"


def test_one_payment_can_settle_several_invoices(db: Db, org) -> None:
    org_id, customer, _ = org
    first, second = db.invoice(org_id, customer), db.invoice(org_id, customer)
    db.pay(org_id, customer, "2000.00", [(first, "1180.00"), (second, "820.00")])
    assert _invoice(db, first)["status"] == "paid"
    assert _invoice(db, second)["amount_outstanding"] == Decimal("360.00")


def test_invalid_allocations_are_rejected(db: Db, org) -> None:
    org_id, customer, _ = org
    invoice = db.invoice(org_id, customer)
    other_customer = db.customer(org_id, "Initech")
    draft = db.invoice(org_id, customer, send=False)
    usd = db.invoice(org_id, customer, currency="USD")

    with db.expect_error("exceeds the outstanding balance"):
        db.pay(org_id, customer, "5000.00", [(invoice, "1180.01")])
    with db.expect_error("exceed the payment amount"):
        db.pay(org_id, customer, "100.00", [(invoice, "100.01")])
    with db.expect_error("different customer"):
        db.pay(org_id, other_customer, "100.00", [(invoice, "100.00")])
    with db.expect_error("cannot receive payments"):
        db.pay(org_id, customer, "100.00", [(draft, "100.00")])
    with db.expect_error("is in USD"):
        db.pay(org_id, customer, "100.00", [(usd, "100.00")])
    assert db.val("select count(*) from payments") == 0, "failed payments must leave no trace"


def test_record_payment_is_idempotent(db: Db, org) -> None:
    org_id, customer, _ = org
    invoice = db.invoice(org_id, customer)
    first = db.pay(org_id, customer, "400.00", [(invoice, "400.00")], key="same-key")
    second = db.pay(org_id, customer, "400.00", [(invoice, "400.00")], key="same-key")
    assert first == second
    assert db.val("select count(*) from payments") == 1
    assert _invoice(db, invoice)["amount_paid"] == Decimal("400.00")


def test_possible_duplicates_are_detected(db: Db, org) -> None:
    org_id, customer, _ = org
    invoice = db.invoice(org_id, customer)
    payment = db.pay(org_id, customer, "400.00", [(invoice, "400.00")], reference="UTR123")
    by_amount = db.all("select id from find_duplicate_payments(%s, %s, 400.00, current_date + 2, null)", [org_id, customer])
    by_reference = db.all("select id from find_duplicate_payments(%s, %s, 1.00, current_date - 60, 'utr123')", [org_id, customer])
    none = db.all("select id from find_duplicate_payments(%s, %s, 401.00, current_date, 'OTHER')", [org_id, customer])
    assert by_amount == [{"id": payment}] and by_reference == [{"id": payment}] and none == []


def test_payments_are_immutable_and_voiding_restores_the_balance(db: Db, org) -> None:
    org_id, customer, _ = org
    invoice = db.invoice(org_id, customer)
    payment = db.pay(org_id, customer, "1180.00", [(invoice, "1180.00")])
    assert _invoice(db, invoice)["status"] == "paid"

    with db.expect_error("immutable"):
        db.run("update payments set amount = 1 where id = %s", [payment])
    with db.expect_error("permission denied"):
        db.run("delete from payments where id = %s", [payment])
    with db.expect_error("permission denied"):
        db.run("delete from payment_allocations where payment_id = %s", [payment])
    db.system()
    with db.expect_error("audit trail"):
        db.run("delete from payments where id = %s", [payment])
    with db.expect_error("audit trail"):
        db.run("update payment_allocations set amount = 1 where payment_id = %s", [payment])
    with db.expect_error("audit trail"):
        db.run("delete from audit_logs")

    db.login(org[2])
    db.run("update payments set voided_at = now(), void_reason = 'Entered twice' where id = %s", [payment])
    row = _invoice(db, invoice)
    assert (row["status"], row["amount_paid"], row["paid_on"]) == ("sent", Decimal("0.00"), None)
    assert db.val("select status from recovery_workflows where invoice_id = %s", [invoice]) == "active"
    actions = [r["action"] for r in db.all("select action from audit_logs where invoice_id = %s", [invoice])]
    assert {"invoice.created", "invoice.sent", "payment.allocated", "invoice.paid", "payment.voided"} <= set(actions)


def test_paid_invoices_are_locked(db: Db, org) -> None:
    org_id, customer, _ = org
    invoice = db.invoice(org_id, customer)
    db.pay(org_id, customer, "1180.00", [(invoice, "1180.00")])
    with db.expect_error("cannot be edited"):
        db.run("update invoice_items set unit_price = 1 where invoice_id = %s", [invoice])
    with db.expect_error("cannot be edited"):
        db.run("update invoices set due_date = due_date + 5 where id = %s", [invoice])
    assert db.run("delete from invoices where id = %s", [invoice]) == 0


def test_overdue_is_derived_from_the_due_date(db: Db, org) -> None:
    org_id, customer, _ = org
    late = db.invoice(org_id, customer, due_in_days=-5)
    row = _invoice(db, late)
    assert (row["status"], row["effective_status"], row["days_overdue"], row["ageing_bucket"]) == ("sent", "overdue", 5, "1_30")
    summary = db.val("select dashboard_summary(%s, 'INR')", [org_id])
    assert summary["overdue"] == 1180.0 and summary["outstanding"] == 1180.0
    assert summary["ageing"]["1_30"] == {"amount": 1180.0, "count": 1}


def test_dispute_stops_automation_and_can_be_resolved(db: Db, org) -> None:
    org_id, customer, _ = org
    invoice = db.invoice(org_id, customer)
    db.run(
        """insert into reminders (organisation_id, invoice_id, customer_id, stage, body, status, dedupe_key)
           values (%s, %s, %s, 'Manual reminder', 'Please pay invoice', 'scheduled', 'manual:test-1')""",
        [org_id, invoice, customer],
    )
    db.run("update invoices set status = 'disputed', dispute_reason = 'Wrong quantity' where id = %s", [invoice])
    assert db.val("select status from recovery_workflows where invoice_id = %s", [invoice]) == "human_review"
    assert db.val("select status from reminders where invoice_id = %s", [invoice]) == "cancelled"
    with db.expect_error("open, undisputed"):
        db.run(
            """insert into reminders (organisation_id, invoice_id, customer_id, stage, body, dedupe_key)
               values (%s, %s, %s, 'Manual reminder', 'Please pay invoice', 'manual:test-2')""",
            [org_id, invoice, customer],
        )
    db.run("update invoices set status = 'sent' where id = %s", [invoice])
    assert db.val("select status from recovery_workflows where invoice_id = %s", [invoice]) == "active"


def test_promise_is_fulfilled_only_by_payment_and_broken_only_after_its_date(db: Db, org) -> None:
    org_id, customer, owner = org
    kept, missed = db.invoice(org_id, customer), db.invoice(org_id, customer)
    for invoice in (kept, missed):
        db.run(
            "insert into payment_promises (organisation_id, invoice_id, customer_id, promised_amount, promised_date)"
            " values (%s, %s, %s, 600.00, current_date + 3)", [org_id, invoice, customer])
    assert db.val("select status from recovery_workflows where invoice_id = %s", [kept]) == "awaiting_promise"
    with db.expect_error("only by recorded payments"):
        db.run("update payment_promises set status = 'fulfilled' where invoice_id = %s", [kept])

    db.system()
    assert db.val("select app.mark_broken_promises()") == 0, "a promise is not broken before its date"

    db.login(owner)
    db.pay(org_id, customer, "300.00", [(kept, "300.00")])
    assert db.val("select status from payment_promises where invoice_id = %s", [kept]) == "pending"
    db.pay(org_id, customer, "300.00", [(kept, "300.00")])
    assert db.val("select status from payment_promises where invoice_id = %s", [kept]) == "fulfilled"
    assert db.val("select status from recovery_workflows where invoice_id = %s", [kept]) == "active"

    db.system()
    db.run("alter table payment_promises disable trigger payment_promises_before_update")
    db.run("update payment_promises set promised_date = current_date - 2 where invoice_id = %s", [missed])
    db.run("alter table payment_promises enable trigger payment_promises_before_update")
    assert db.val("select app.mark_broken_promises()") == 1
    promise = db.one("select status, follow_up_date from payment_promises where invoice_id = %s", [missed])
    assert promise["status"] == "broken" and promise["follow_up_date"] is not None
    assert db.val("select status from recovery_workflows where invoice_id = %s", [missed]) == "active"
    assert db.val("select count(*) from notifications where kind = 'promise_broken' and user_id = %s", [owner]) == 1
    assert db.val("select status from payment_promises where invoice_id = %s", [kept]) == "fulfilled"


def test_plan_limits_are_enforced_in_the_database(db: Db, org) -> None:
    org_id, customer, owner = org
    db.system()
    db.run(
        """insert into subscription_plans (id, name, description, entitlements, is_public)
           values ('tiny', 'Tiny', 'test plan', '{"max_users": 1, "max_invoices_per_month": 1,
             "max_reminders_per_month": 0, "max_automation_rules": 1, "promise_tracking": false}', false)""")
    db.run("update subscriptions set plan_id = 'tiny' where organisation_id = %s", [org_id])

    db.login(owner)
    invoice = db.invoice(org_id, customer)
    with db.expect_error("allows 1 invoices per month"):
        db.invoice(org_id, customer)
    with db.expect_error("not included in your current plan"):
        db.run(
            "insert into payment_promises (organisation_id, invoice_id, customer_id, promised_amount, promised_date)"
            " values (%s, %s, %s, 10, current_date + 1)", [org_id, invoice, customer])
    with db.expect_error("allows 1 team members"):
        db.val("select create_invitation(%s, 'second@example.test', 'viewer')", [org_id])
    with db.expect_error("allows 1 automation sequences"):
        db.run("insert into automation_rules (organisation_id, name) values (%s, 'Second')", [org_id])


def test_expired_trial_blocks_new_financial_records_but_keeps_data_readable(db: Db, org) -> None:
    org_id, customer, owner = org
    invoice = db.invoice(org_id, customer)
    db.system()
    db.run("update subscriptions set trial_ends_at = now() - interval '1 day' where organisation_id = %s", [org_id])
    db.login(owner)
    assert db.val("select org_entitlements(%s)", [org_id])["active"] is False
    with db.expect_error("subscription is not active"):
        db.invoice(org_id, customer)
    with db.expect_error("subscription is not active"):
        db.pay(org_id, customer, "10.00", [(invoice, "10.00")])
    assert len(db.all("select id from invoices")) == 1


def test_collection_metrics_reconcile(db: Db, org) -> None:
    org_id, customer, _ = org
    first, second = db.invoice(org_id, customer), db.invoice(org_id, customer)
    db.pay(org_id, customer, "1180.00", [(first, "1180.00")])
    db.pay(org_id, customer, "180.00", [(second, "180.00")])
    metrics = db.val("select collection_metrics(%s, 'INR', current_date - 30, current_date)", [org_id])
    assert metrics["invoiced"] == 2360.0 and metrics["collected"] == 1360.0
    assert metrics["beginning_ar"] == 0 and metrics["ending_ar"] == 1000.0
    assert metrics["invoices_paid"] == 1
    trend = db.all("select * from cashflow_trend(%s, 'INR', 3)", [org_id])
    assert len(trend) == 3
    assert sum(r["invoiced"] for r in trend) == Decimal("2360.00")
    assert trend[-1]["outstanding_end"] == Decimal("1000.00")
    stats = db.one("select * from customer_stats where customer_id = %s", [customer])
    assert stats["outstanding"] == Decimal("1000.00") and stats["risk_level"] == "low"
