"""Database-backed job queue for on-demand work (AI drafts, invoice extraction).

Jobs are claimed with FOR UPDATE SKIP LOCKED, retried with backoff up to
max_attempts, and then moved to 'dead' (the dead-letter state) with the error kept.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from psycopg.types.json import Jsonb

from .ai import AIError
from .config import Settings
from .db import Conn
from .logging_setup import log

logger = logging.getLogger("capflow.jobs")

Handler = Callable[[Conn, Settings, dict[str, Any]], dict[str, Any]]


def _ai_draft(conn: Conn, settings: Settings, payload: dict[str, Any]) -> dict[str, Any]:
    from .recovery import redraft_with_ai

    model = redraft_with_ai(conn, settings, str(payload["reminder_id"]), payload.get("tone", "professional"))
    return {"model": model}


def _extract_invoice(conn: Conn, settings: Settings, payload: dict[str, Any]) -> dict[str, Any]:
    """Extracts fields from text already pulled from a PDF. The result is a suggestion
    shown to the user for review; it never creates or changes an invoice by itself."""
    from .integrations import ai_client

    client = ai_client(conn, str(payload["organisation_id"]), settings)
    if client is None:
        raise AIError("AI integration is not configured")
    text = str(payload.get("text", ""))
    if len(text.strip()) < 20:
        raise AIError("no readable text in the document")
    return client.extract_invoice(text).model_dump()


HANDLERS: dict[str, Handler] = {"ai_draft_reminder": _ai_draft, "ai_extract_invoice": _extract_invoice}

# Errors that will not succeed on retry.
PERMANENT = ("not configured", "no longer awaiting", "not found", "no readable text")


def run_jobs(conn: Conn, settings: Settings, *, limit: int = 10, now: datetime | None = None,
             handlers: dict[str, Handler] | None = None, commit: Callable[[], None] | None = None) -> dict[str, int]:
    now = now or datetime.now(UTC)
    checkpoint = commit or conn.commit
    table = handlers or HANDLERS
    stats = {"succeeded": 0, "retrying": 0, "dead": 0}
    claimed = conn.execute(
        """update background_jobs set status = 'running', locked_at = now(), attempts = attempts + 1
           where id in (select id from background_jobs where status = 'queued' and run_at <= %s
                        order by run_at limit %s for update skip locked)
           returning *""",
        [now, limit],
    ).fetchall()
    checkpoint()
    for job in claimed:
        payload = dict(job["payload"] or {})
        payload.setdefault("organisation_id", str(job["organisation_id"]))
        try:
            handler = table.get(job["job_type"])
            if handler is None:
                raise AIError(f"no handler for {job['job_type']} (not found)")
            conn.execute("savepoint job")
            result = handler(conn, settings, payload)
            conn.execute("release savepoint job")
            conn.execute("update background_jobs set status = 'succeeded', result = %s, finished_at = now(), last_error = null where id = %s",
                         [Jsonb(result), job["id"]])
            stats["succeeded"] += 1
        except Exception as exc:  # noqa: BLE001 - every failure must be recorded on the job
            conn.execute("rollback to savepoint job")
            message = str(exc)[:500]
            permanent = any(p in message for p in PERMANENT)
            if permanent or job["attempts"] >= job["max_attempts"]:
                conn.execute("update background_jobs set status = %s, last_error = %s, finished_at = now() where id = %s",
                             ["failed" if permanent else "dead", message, job["id"]])
                stats["dead"] += 1
            else:
                conn.execute("update background_jobs set status = 'queued', last_error = %s, run_at = %s where id = %s",
                             [message, now + timedelta(seconds=30 * 2 ** job["attempts"]), job["id"]])
                stats["retrying"] += 1
            log(logger, logging.WARNING, "job failed", job=str(job["id"]), type=job["job_type"], error=message, permanent=permanent)
        checkpoint()
    return stats


def recover_stale_jobs(conn: Conn, *, minutes: int = 15) -> int:
    rows = conn.execute(
        "update background_jobs set status = 'queued', locked_at = null where status = 'running' and locked_at < now() - make_interval(mins => %s) returning id",
        [minutes],
    ).fetchall()
    return len(rows)
