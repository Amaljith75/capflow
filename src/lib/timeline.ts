import type { AuditLog } from "@/lib/types";

export interface TimelineEntry {
  title: string;
  detail?: string;
  tone: "neutral" | "green" | "red" | "amber" | "blue";
}

/** Turns an audit log row into a human-readable recovery timeline entry. */
export function describeEvent(log: AuditLog, money: (value: unknown) => string): TimelineEntry {
  const m = log.metadata ?? {};
  const str = (key: string) => (typeof m[key] === "string" || typeof m[key] === "number" ? String(m[key]) : "");
  switch (log.action) {
    case "invoice.created": return { title: "Invoice created", tone: "neutral" };
    case "invoice.sent": return { title: str("from") === "disputed" ? "Dispute resolved" : "Marked as sent", detail: str("from") === "disputed" ? "Recovery resumed" : "Recovery sequence started", tone: "blue" };
    case "invoice.partially_paid": return { title: "Partially paid", tone: "amber" };
    case "invoice.paid": return { title: "Paid in full", detail: "Recovery completed", tone: "green" };
    case "invoice.disputed": return { title: "Marked as disputed", detail: str("reason") || "Automation stopped for human review", tone: "amber" };
    case "invoice.cancelled": return { title: "Invoice cancelled", tone: "neutral" };
    case "invoice.archived": return { title: "Invoice archived", tone: "neutral" };
    case "invoice.restored": return { title: "Invoice restored", tone: "neutral" };
    case "invoice.due_date_changed": return { title: "Due date changed", detail: `${str("from")} → ${str("to")}`, tone: "neutral" };
    case "payment.allocated": return { title: `Payment of ${money(m.amount)} applied`, tone: "green" };
    case "payment.voided": return { title: "Payment voided", detail: str("reason"), tone: "red" };
    case "promise.created": return { title: `Customer promised ${money(m.amount)}`, detail: `Expected by ${str("date")}. Reminders on hold.`, tone: "blue" };
    case "promise.fulfilled": return { title: "Payment promise kept", tone: "green" };
    case "promise.broken": return { title: "Payment promise missed", detail: `No verified payment by ${str("date")}`, tone: "red" };
    case "promise.cancelled": return { title: "Payment promise cancelled", tone: "neutral" };
    case "reminder.planned": return { title: `Reminder drafted: ${str("stage")}`, detail: str("mode") === "auto" ? "Scheduled automatically" : "Waiting for approval", tone: "neutral" };
    case "reminder.approved": return { title: `Reminder approved: ${str("stage")}`, tone: "blue" };
    case "reminder.sent": return { title: `Reminder sent: ${str("stage")}`, detail: `${str("tone")} tone via ${str("channel")}${m.sandbox ? " (sandbox, not delivered)" : ""}`, tone: "blue" };
    case "reminder.failed": return { title: `Reminder failed: ${str("stage")}`, detail: str("error"), tone: "red" };
    case "reminder.cancelled": return { title: `Reminder cancelled: ${str("stage")}`, detail: str("error"), tone: "neutral" };
    case "recovery.paused": return { title: "Recovery paused", tone: "amber" };
    case "recovery.resumed": return { title: "Recovery resumed", tone: "blue" };
    case "recovery.escalated": return { title: "Escalated to finance manager", detail: str("stage"), tone: "red" };
    case "recovery.deescalated": return { title: "Escalation cleared", tone: "blue" };
    default: return { title: log.action.replace(/[._]/g, " "), tone: "neutral" };
  }
}
