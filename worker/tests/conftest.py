"""Shared fixtures.

Database tests run against a PostgreSQL database that has the Supabase shim and
all migrations applied (see scripts/db-reset-local.sh). Every test runs inside a
transaction that is rolled back, so tests never see each other's data.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import psycopg
import pytest
from psycopg.rows import dict_row

TEST_DSN = os.environ.get("TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/capflow_test")


class Db:
    """Thin helper around one connection with role switching like PostgREST does."""

    def __init__(self, conn: psycopg.Connection[dict[str, Any]]) -> None:
        self.conn = conn

    def system(self) -> None:
        self.conn.execute("reset role")
        self.conn.execute("select set_config('request.jwt.claim.sub', '', true)")

    def login(self, user_id: uuid.UUID | str) -> None:
        self.conn.execute("reset role")
        self.conn.execute("select set_config('request.jwt.claim.sub', %s, true)", [str(user_id)])
        self.conn.execute("set local role authenticated")

    def anon(self) -> None:
        self.conn.execute("reset role")
        self.conn.execute("select set_config('request.jwt.claim.sub', '', true)")
        self.conn.execute("set local role anon")

    def all(self, sql: str, params: Any = None) -> list[dict[str, Any]]:
        return self.conn.execute(sql, params).fetchall()

    def one(self, sql: str, params: Any = None) -> dict[str, Any]:
        row = self.conn.execute(sql, params).fetchone()
        assert row is not None, "expected a row"
        return row

    def val(self, sql: str, params: Any = None) -> Any:
        return next(iter(self.one(sql, params).values()))

    def run(self, sql: str, params: Any = None) -> int:
        return self.conn.execute(sql, params).rowcount

    @contextmanager
    def expect_error(self, fragment: str) -> Iterator[None]:
        """Asserts the block raises a database error containing `fragment`, then recovers."""
        self.conn.execute("savepoint expect_error")
        try:
            yield
        except psycopg.Error as exc:
            self.conn.execute("rollback to savepoint expect_error")
            assert fragment.lower() in str(exc).lower(), f"expected {fragment!r} in {exc!s}"
        else:
            raise AssertionError(f"expected a database error containing {fragment!r}")

    # -- builders -----------------------------------------------------------
    def user(self, email: str | None = None) -> uuid.UUID:
        self.system()
        email = email or f"{uuid.uuid4().hex[:10]}@example.test"
        return self.val("insert into auth.users (email) values (%s) returning id", [email])

    def org(self, owner: uuid.UUID, name: str = "Acme Traders", currency: str = "INR") -> uuid.UUID:
        self.login(owner)
        return self.val("select create_organisation(%s, %s, 'Asia/Kolkata', 'IN')", [name, currency])

    def member(self, org: uuid.UUID, role: str) -> uuid.UUID:
        user = self.user()
        self.system()
        self.run(
            "insert into organisation_members (organisation_id, user_id, role) values (%s, %s, %s)",
            [org, user, role],
        )
        return user

    def customer(self, org: uuid.UUID, name: str = "Globex Pvt Ltd", currency: str = "INR") -> uuid.UUID:
        return self.val(
            "insert into customers (organisation_id, name, email, currency) values (%s, %s, %s, %s) returning id",
            [org, name, f"{uuid.uuid4().hex[:8]}@customer.test", currency],
        )

    def invoice(
        self,
        org: uuid.UUID,
        customer: uuid.UUID,
        *,
        items: list[dict[str, Any]] | None = None,
        due_in_days: int = 30,
        send: bool = True,
        currency: str = "INR",
        number: str | None = None,
        issue_days_ago: int = 10,
    ) -> uuid.UUID:
        items = items or [{"description": "Consulting", "quantity": "1", "unit_price": "1000.00", "tax_rate": "18"}]
        return self.val(
            """select save_invoice(%s, null, jsonb_build_object(
                 'customer_id', %s::text, 'invoice_number', %s::text,
                 'issue_date', (current_date - %s::int)::text, 'due_date', (current_date + %s::int)::text,
                 'currency', %s::text), %s::jsonb, %s)""",
            [org, customer, number or f"INV-{uuid.uuid4().hex[:8]}", issue_days_ago, due_in_days, currency,
             psycopg.types.json.Jsonb(items), send],
        )

    def pay(self, org: uuid.UUID, customer: uuid.UUID, amount: str, allocations: list[tuple[uuid.UUID, str]],
            *, key: str | None = None, reference: str | None = None, currency: str = "INR") -> uuid.UUID:
        return self.val(
            "select record_payment(%s, %s, %s, %s, current_date, 'bank_transfer', %s, null, %s::jsonb, %s)",
            [org, customer, amount, currency, reference,
             psycopg.types.json.Jsonb([{"invoice_id": str(i), "amount": a} for i, a in allocations]),
             key or uuid.uuid4().hex],
        )


@pytest.fixture
def db() -> Iterator[Db]:
    try:
        conn = psycopg.connect(TEST_DSN, row_factory=dict_row)
    except psycopg.OperationalError as exc:  # pragma: no cover - environment dependent
        pytest.skip(f"test database not available: {exc}")
    try:
        yield Db(conn)
    finally:
        conn.rollback()
        conn.close()
