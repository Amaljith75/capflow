"""Pure scheduling rules: working hours and which sequence steps are due."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class WorkingHours:
    timezone: str
    start: time
    end: time
    days: frozenset[int]  # ISO weekdays, 1 = Monday

    def contains(self, moment: datetime) -> bool:
        local = moment.astimezone(ZoneInfo(self.timezone))
        return local.isoweekday() in self.days and self.start <= local.time() < self.end

    def next_window(self, moment: datetime) -> datetime:
        """`moment` if it is inside working hours, otherwise the start of the next window (UTC-aware)."""
        if not self.days:
            raise ValueError("no working days configured")
        tz = ZoneInfo(self.timezone)
        local = moment.astimezone(tz)
        if self.contains(moment):
            return moment
        for offset in range(0, 8):
            day = (local + timedelta(days=offset)).date()
            if day.isoweekday() not in self.days:
                continue
            start = datetime.combine(day, self.start, tzinfo=tz)
            if start > local or (offset == 0 and local.time() < self.start):
                return start.astimezone(moment.tzinfo)
        raise AssertionError("unreachable: a working day exists within 8 days")


@dataclass(frozen=True)
class Step:
    id: str
    offset_days: int
    stage: str
    action: str


def select_due_step(steps: list[Step], days_from_due: int, done: set[str]) -> tuple[Step | None, list[Step]]:
    """Returns the step to run now and the earlier due steps to mark skipped.

    Only the latest due step runs, so an invoice imported 20 days overdue gets the
    message appropriate to 20 days overdue instead of every earlier reminder at once.
    """
    due = sorted((s for s in steps if s.offset_days <= days_from_due and s.id not in done), key=lambda s: s.offset_days)
    if not due:
        return None, []
    return due[-1], due[:-1]
