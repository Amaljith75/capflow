"""Single-process scheduler for small deployments without Redis.

Runs the same idempotent tasks as Celery beat on the same intervals.
Usage:  python -m capflow_worker.loop
"""

from __future__ import annotations

import logging
import signal
import time
from collections.abc import Callable
from typing import Any

from .config import get_settings
from .db import connect
from .jobs import recover_stale_jobs, run_jobs
from .logging_setup import configure_logging
from .recovery import dispatch_due, mark_broken_promises, plan_reminders, recover_stuck

logger = logging.getLogger("capflow.loop")


def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    schedule: list[tuple[str, float, Callable[[Any], Any]]] = [
        ("dispatch", 60, lambda c: dispatch_due(c, settings)),
        ("jobs", 30, lambda c: run_jobs(c, settings)),
        ("plan", 300, lambda c: plan_reminders(c, settings)),
        ("recover", 300, lambda c: (recover_stuck(c), recover_stale_jobs(c))),
        ("promises", 1800, mark_broken_promises),
    ]
    next_run = {name: 0.0 for name, _, _ in schedule}
    running = True

    def stop(*_: object) -> None:
        nonlocal running
        running = False

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    while running:
        now = time.monotonic()
        for name, interval, fn in schedule:
            if now >= next_run[name]:
                next_run[name] = now + interval
                try:
                    with connect() as conn:
                        logger.info("%s: %s", name, fn(conn))
                except Exception:
                    logger.exception("%s failed; will retry next interval", name)
        time.sleep(1)


if __name__ == "__main__":
    main()
