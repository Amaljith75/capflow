import type { CustomerStats, DashboardSummary, TrendPoint } from "@/lib/types";

/**
 * Rule-based collections insights. Every insight is computed from real records
 * and carries the figures it was derived from, so a user can verify it.
 * No AI is involved; nothing here is a credit or legal judgement.
 */
export interface Insight {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  evidence: { label: string; value: string }[];
  href?: string;
}

interface Options {
  money: (value: number) => string;
  /** Human description of the period the trend covers, e.g. "Jun – Nov 2026". */
  trendRange: string;
}

export function buildInsights(
  summary: DashboardSummary | null,
  customers: CustomerStats[],
  trend: TrendPoint[],
  { money, trendRange }: Options,
): Insight[] {
  const insights: Insight[] = [];

  for (const c of customers) {
    if (c.overdue_30_plus_count >= 2) {
      const worsening = c.recent_avg_days_late !== null && c.prior_avg_days_late !== null && c.recent_paid_count > 0 && c.prior_paid_count > 0
        && c.recent_avg_days_late > c.prior_avg_days_late;
      insights.push({
        id: `overdue-30-${c.customer_id}`,
        severity: c.overdue_30_plus_count >= 3 ? "critical" : "warning",
        title: `${c.customer_name} has ${c.overdue_30_plus_count} invoices overdue by more than 30 days`,
        detail: worsening
          ? `Their average payment delay rose from ${c.prior_avg_days_late} to ${c.recent_avg_days_late} days over the last 90 days compared with the 90 days before.`
          : "Consider a call or a firmer follow-up for this account.",
        evidence: [
          { label: "Overdue balance", value: money(c.overdue) },
          { label: "Oldest invoice", value: `${c.max_days_overdue} days overdue` },
          { label: "Invoices overdue 30+ days", value: String(c.overdue_30_plus_count) },
        ],
        href: `/customers/${c.customer_id}`,
      });
    } else if (
      c.recent_avg_days_late !== null && c.prior_avg_days_late !== null && c.recent_paid_count >= 2 && c.prior_paid_count >= 2
      && c.recent_avg_days_late - c.prior_avg_days_late >= 7
    ) {
      insights.push({
        id: `slowing-${c.customer_id}`,
        severity: "warning",
        title: `${c.customer_name} is paying more slowly`,
        detail: `Average delay went from ${c.prior_avg_days_late} to ${c.recent_avg_days_late} days late.`,
        evidence: [
          { label: "Last 90 days", value: `${c.recent_avg_days_late} days late across ${c.recent_paid_count} paid invoices` },
          { label: "Previous 90 days", value: `${c.prior_avg_days_late} days late across ${c.prior_paid_count} paid invoices` },
        ],
        href: `/customers/${c.customer_id}`,
      });
    }
    if (c.broken_promises >= 2) {
      insights.push({
        id: `promises-${c.customer_id}`,
        severity: "warning",
        title: `${c.customer_name} has missed ${c.broken_promises} payment promises`,
        detail: "Promises from this customer have not been reliable. Ask for a part payment or a firm date in writing.",
        evidence: [{ label: "Broken promises", value: String(c.broken_promises) }, { label: "Outstanding", value: money(c.outstanding) }],
        href: `/customers/${c.customer_id}`,
      });
    }
  }

  if (summary && summary.outstanding > 0) {
    const sorted = [...customers].sort((a, b) => b.outstanding - a.outstanding);
    const top = sorted[0];
    if (top && customers.length >= 3 && top.outstanding / summary.outstanding >= 0.4) {
      insights.push({
        id: "concentration",
        severity: "info",
        title: `${Math.round((top.outstanding / summary.outstanding) * 100)}% of your receivables sit with ${top.customer_name}`,
        detail: "A single late payment from this customer would have an outsized effect on your cash position.",
        evidence: [{ label: top.customer_name, value: money(top.outstanding) }, { label: "Total outstanding", value: money(summary.outstanding) }],
        href: `/customers/${top.customer_id}`,
      });
    }
    const old = (summary.ageing["61_90"]?.amount ?? 0) + (summary.ageing["90_plus"]?.amount ?? 0);
    if (old / summary.outstanding >= 0.25) {
      insights.push({
        id: "ageing",
        severity: "critical",
        title: `${Math.round((old / summary.outstanding) * 100)}% of outstanding receivables are more than 60 days overdue`,
        detail: "Older debts become harder to collect. Prioritise these invoices for personal follow-up.",
        evidence: [
          { label: "61–90 days", value: money(summary.ageing["61_90"]?.amount ?? 0) },
          { label: "90+ days", value: money(summary.ageing["90_plus"]?.amount ?? 0) },
          { label: "Total outstanding", value: money(summary.outstanding) },
        ],
        href: "/invoices?view=overdue&sort=days_overdue",
      });
    }
  }

  const complete = trend.slice(0, -1); // the current month is still in progress
  if (complete.length >= 2) {
    const last = complete[complete.length - 1];
    const previous = complete[complete.length - 2];
    if (previous.collected > 0 && last.collected < previous.collected * 0.75) {
      insights.push({
        id: "collections-drop",
        severity: "warning",
        title: `Collections fell ${Math.round((1 - last.collected / previous.collected) * 100)}% month over month`,
        detail: `Based on recorded payments for ${trendRange}.`,
        evidence: [{ label: "Previous month", value: money(previous.collected) }, { label: "Last full month", value: money(last.collected) }],
        href: "/analytics",
      });
    }
  }

  const order = { critical: 0, warning: 1, info: 2 };
  return insights.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 8);
}
