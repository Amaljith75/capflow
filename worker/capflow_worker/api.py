"""Health and admin endpoints for the worker.

  GET  /health            database (and Redis, when configured) connectivity — for the host's health check
  GET  /status            queue depths and recent failures (requires the admin token)
  POST /run/{task}        run a periodic task now (requires the admin token)

Run:  uvicorn capflow_worker.api:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import hmac
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException

from .config import get_settings
from .db import connect

app = FastAPI(title="Capflow worker", docs_url=None, redoc_url=None)


def require_admin(authorization: str | None = Header(default=None)) -> None:
    token = get_settings().worker_admin_token
    if not token:
        raise HTTPException(status_code=404)
    if not authorization or not hmac.compare_digest(authorization, f"Bearer {token}"):
        raise HTTPException(status_code=401)


@app.get("/health")
def health() -> dict[str, Any]:
    result: dict[str, Any] = {"database": "ok"}
    try:
        with connect() as conn:
            conn.execute("select 1")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"database unavailable: {type(exc).__name__}") from exc
    try:
        import redis

        redis.Redis.from_url(get_settings().redis_url, socket_timeout=2).ping()
        result["redis"] = "ok"
    except Exception:  # noqa: BLE001 - Redis is optional when using the single-process loop
        result["redis"] = "unavailable"
    result["email"] = "live" if get_settings().email_live else "sandbox"
    return result


@app.get("/status", dependencies=[Depends(require_admin)])
def status() -> dict[str, Any]:
    with connect() as conn:
        reminders = conn.execute("select status, count(*) as n from reminders group by status").fetchall()
        jobs = conn.execute("select status, count(*) as n from background_jobs group by status").fetchall()
        overdue = conn.execute("select count(*) as n from reminders where status = 'scheduled' and scheduled_for < now() - interval '15 minutes'").fetchone()
    return {
        "reminders": {r["status"]: r["n"] for r in reminders},
        "jobs": {j["status"]: j["n"] for j in jobs},
        "reminders_past_due": overdue["n"] if overdue else 0,
    }


@app.post("/run/{task}", dependencies=[Depends(require_admin)])
def run(task: str) -> dict[str, Any]:
    from .tasks import TASKS

    if task not in TASKS:
        raise HTTPException(status_code=404, detail="unknown task")
    return {"task": task, "result": TASKS[task].apply().get()}
