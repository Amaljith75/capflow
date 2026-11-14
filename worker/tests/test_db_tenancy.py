"""Tenant isolation, role enforcement and RLS."""

from __future__ import annotations

import pytest

from .conftest import Db

pytestmark = pytest.mark.db


def test_organisation_data_is_invisible_to_other_tenants(db: Db) -> None:
    alice, bob = db.user(), db.user()
    org_a = db.org(alice, "Alpha Ltd")
    customer_a = db.customer(org_a)
    invoice_a = db.invoice(org_a, customer_a)
    db.pay(org_a, customer_a, "100.00", [(invoice_a, "100.00")])
    org_b = db.org(bob, "Beta Ltd")

    db.login(bob)
    for table in ("customers", "invoices", "invoice_items", "payments", "payment_allocations",
                  "recovery_workflows", "audit_logs", "subscriptions", "automation_rules",
                  "communication_templates", "invoice_ledger", "customer_stats"):
        rows = db.all(f"select * from {table} where organisation_id = %s", [org_a])  # noqa: S608
        assert rows == [], f"{table} leaked rows across tenants"
    assert db.all("select id from organisations") == [{"id": org_b}]
    assert db.one("select dashboard_summary(%s, 'INR') as s", [org_a])["s"]["outstanding"] == 0


def test_other_tenant_cannot_write_into_organisation(db: Db) -> None:
    alice, bob = db.user(), db.user()
    org_a = db.org(alice)
    customer_a = db.customer(org_a)
    invoice_a = db.invoice(org_a, customer_a)
    db.org(bob)

    db.login(bob)
    with db.expect_error("row-level security"):
        db.customer(org_a, "Intruder Inc")
    with db.expect_error("row-level security"):
        db.invoice(org_a, customer_a)
    with db.expect_error("row-level security"):
        db.pay(org_a, customer_a, "10.00", [(invoice_a, "10.00")])
    assert db.run("update invoices set notes = 'hacked' where id = %s", [invoice_a]) == 0
    assert db.run("update customers set name = 'hacked' where id = %s", [customer_a]) == 0
    with db.expect_error("Not a member"):
        db.one("select org_entitlements(%s)", [org_a])


def test_customer_from_another_org_cannot_be_invoiced(db: Db) -> None:
    alice, bob = db.user(), db.user()
    org_a = db.org(alice)
    customer_a = db.customer(org_a)
    org_b = db.org(bob)
    db.login(bob)
    with db.expect_error("does not belong"):
        db.invoice(org_b, customer_a)


def test_anonymous_role_has_no_access_to_tenant_data(db: Db) -> None:
    alice = db.user()
    org = db.org(alice)
    db.customer(org)
    db.anon()
    with db.expect_error("permission denied"):
        db.all("select * from customers")
    with db.expect_error("permission denied"):
        db.all("select create_organisation('x corp', 'INR', 'UTC', 'IN')")
    with db.expect_error("permission denied"):
        db.all("select rate_limit_hit('x', 1, 60)")
    assert len(db.all("select id from subscription_plans")) == 4


def test_role_ladder(db: Db) -> None:
    owner = db.user()
    org = db.org(owner)
    db.system()
    db.run("update subscriptions set plan_id = 'business' where organisation_id = %s", [org])
    viewer, accountant, manager = db.member(org, "viewer"), db.member(org, "accountant"), db.member(org, "finance_manager")

    db.login(viewer)
    assert len(db.all("select id from automation_rules")) == 1
    with db.expect_error("row-level security"):
        db.customer(org)

    db.login(accountant)
    customer = db.customer(org)
    invoice = db.invoice(org, customer)
    payment = db.pay(org, customer, "100.00", [(invoice, "100.00")])
    assert db.run("update payments set void_reason = 'typo', voided_at = now() where id = %s", [payment]) == 0
    assert db.run("update automation_rules set approval_mode = 'auto'") == 0
    with db.expect_error("Only admins"):
        db.val("select create_invitation(%s, 'new@example.test', 'viewer')", [org])

    db.login(manager)
    assert db.run("update payments set void_reason = 'typo', voided_at = now() where id = %s", [payment]) == 1
    assert db.run("update automation_rules set approval_mode = 'auto'") == 1
    assert db.run("update organisations set name = 'Renamed'") == 0
    with db.expect_error("Only an owner"):
        db.run("select delete_organisation(%s)", [org])


def test_invitation_requires_matching_email_and_last_owner_is_protected(db: Db) -> None:
    owner = db.user()
    org = db.org(owner)
    invitee, stranger = db.user("invitee@example.test"), db.user("stranger@example.test")

    db.login(owner)
    token = db.val("select create_invitation(%s, 'Invitee@Example.test', 'accountant')", [org])
    db.login(stranger)
    with db.expect_error("different email"):
        db.val("select accept_invitation(%s)", [token])
    db.login(invitee)
    assert db.val("select accept_invitation(%s)", [token]) == org
    with db.expect_error("no longer valid"):
        db.val("select accept_invitation(%s)", [token])
    assert db.val("select role from organisation_members where user_id = %s", [invitee]) == "accountant"

    db.login(owner)
    own_membership = db.val("select id from organisation_members where user_id = %s", [owner])
    with db.expect_error("at least one owner"):
        db.run("select remove_member(%s)", [own_membership])
    with db.expect_error("at least one owner"):
        db.run("select update_member_role(%s, 'admin')", [own_membership])


def test_deleted_organisation_is_inaccessible(db: Db) -> None:
    owner = db.user()
    org = db.org(owner)
    db.customer(org)
    db.run("select delete_organisation(%s)", [org])
    assert db.all("select id from organisations") == []
    assert db.all("select id from customers") == []
