"""Database access. The worker connects as a privileged role, so auth.uid() is NULL and
database triggers treat its writes as trusted system actions (see migration 0002)."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import psycopg
from psycopg.rows import dict_row

from .config import get_settings

Conn = psycopg.Connection[dict[str, Any]]


@contextmanager
def connect(dsn: str | None = None) -> Iterator[Conn]:
    """One connection per unit of work; commits on success, rolls back on error."""
    conn: Conn = psycopg.connect(dsn or get_settings().database_url, row_factory=dict_row, autocommit=False)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
