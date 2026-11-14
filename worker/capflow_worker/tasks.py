"""Celery application and periodic schedule.

Every task is idempotent: the database (unique dedupe keys, SKIP LOCKED claims,
status checks) guarantees that running a task twice, or on two workers at once,
cannot duplicate a reminder. Redis is only the trigger, never the source of truth.

Run:  celery -A capflow_worker.tasks worker --beat --loglevel=INFO
"""

from __future__ import annotations

import logging
from dataclasses import asdict
from typing import Any

from celery import Celery

from .config import get_settings
from .db import connect
from .jobs import recover_stale_jobs, run_jobs
from .logging_setup import configure_logging, log
from .recovery import dispatch_due, mark_broken_promises, plan_reminders, recover_stuck

settings = get_settings()
configure_logging(settings.log_level)
logger = logging.getLogger("capflow.tasks")

app = Celery("capflow", broker=settings.redis_url, backend=None)
app.conf.update(
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_time_limit=600,
    task_soft_time_limit=540,
    broker_connection_retry_on_startup=True,
    timezone="UTC",
    beat_schedule={
        "dispatch-reminders": {"task": "capflow.dispatch", "schedule": 60.0},
        "run-jobs": {"task": "capflow.jobs", "schedule": 30.0},
        "plan-reminders": {"task": "capflow.plan", "schedule": 300.0},
        "recover-stuck": {"task": "capflow.recover", "schedule": 300.0},
        "broken-promises": {"task": "capflow.promises", "schedule": 1800.0},
    },
)


def _run(name: str, fn: Any) -> dict[str, Any]:
    try:
        with connect() as conn:
            result = fn(conn)
    except Exception:
        log(logger, logging.ERROR, "task failed", task=name)
        logger.exception("task %s failed", name)
        raise
    out = asdict(result) if hasattr(result, "__dataclass_fields__") else ({"count": result} if isinstance(result, int) else result)
    log(logger, logging.INFO, "task finished", task=name, **out)
    return out


@app.task(name="capflow.plan", autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def plan() -> dict[str, Any]:
    return _run("plan", lambda conn: plan_reminders(conn, settings))


@app.task(name="capflow.dispatch", autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def dispatch() -> dict[str, Any]:
    return _run("dispatch", lambda conn: dispatch_due(conn, settings))


@app.task(name="capflow.jobs")
def jobs() -> dict[str, Any]:
    return _run("jobs", lambda conn: run_jobs(conn, settings))


@app.task(name="capflow.recover")
def recover() -> dict[str, Any]:
    return _run("recover", lambda conn: {"reminders": recover_stuck(conn), "jobs": recover_stale_jobs(conn)})


@app.task(name="capflow.promises", autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def promises() -> dict[str, Any]:
    return _run("promises", mark_broken_promises)


TASKS = {"plan": plan, "dispatch": dispatch, "jobs": jobs, "recover": recover, "promises": promises}
