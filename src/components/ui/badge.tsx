import { cn, titleCase } from "@/lib/utils";

const tones = {
  neutral: "bg-subtle text-ink-soft border-line",
  green: "bg-brand-50 text-brand-800 border-brand-200",
  red: "bg-danger-50 text-danger-700 border-danger-100",
  amber: "bg-warn-50 text-warn-700 border-warn-100",
  blue: "bg-info-100/50 text-info-700 border-info-100",
  dark: "bg-ink text-white border-ink",
} as const;

export type BadgeTone = keyof typeof tones;

export function Badge({ tone = "neutral", dot, className, children }: {
  tone?: BadgeTone; dot?: boolean; className?: string; children: React.ReactNode;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone], className)}>
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, BadgeTone> = {
  draft: "neutral", sent: "blue", partially_paid: "amber", paid: "green", overdue: "red", disputed: "amber", cancelled: "neutral",
  pending: "amber", fulfilled: "green", broken: "red",
  pending_approval: "amber", scheduled: "blue", sending: "blue", failed: "red", skipped: "neutral",
  active: "green", paused: "neutral", awaiting_promise: "amber", escalated: "red", human_review: "amber", completed: "green", stopped: "neutral",
  delivered: "green", opened: "green", bounced: "red", complained: "red", queued: "neutral", sandbox: "amber",
  trialing: "blue", past_due: "red", expired: "red", none: "neutral",
  low: "green", medium: "amber", high: "red",
  queued_job: "neutral", running: "blue", succeeded: "green", dead: "red",
};

const STATUS_LABELS: Record<string, string> = {
  pending_approval: "Needs approval", human_review: "Human review", awaiting_promise: "Awaiting promise",
  sandbox: "Sandbox (not delivered)", past_due: "Payment failed", low: "Low risk", medium: "Medium risk", high: "High risk",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge tone={STATUS_TONES[status] ?? "neutral"} dot className={className}>
      {STATUS_LABELS[status] ?? titleCase(status)}
    </Badge>
  );
}
