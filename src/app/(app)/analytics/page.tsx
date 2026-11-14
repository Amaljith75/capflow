import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, Lightbulb } from "lucide-react";
import { OutstandingChart, RateChart } from "@/components/charts/charts";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader, Tabs } from "@/components/ui/misc";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { getEntitlements, requireContext } from "@/lib/auth/context";
import { AGEING_BUCKETS, loadCustomerStats, loadSummary, loadTrend, resolveCurrency } from "@/lib/data/receivables";
import { addDays, formatDate, formatMonth } from "@/lib/dates";
import { buildInsights } from "@/lib/insights";
import { formatMoney } from "@/lib/money";
import { cn, param, titleCase } from "@/lib/utils";

export const metadata: Metadata = { title: "Analytics" };
const PERIODS = [30, 90, 180, 365];

interface Metrics {
  invoiced: number; collected: number; beginning_ar: number; ending_ar: number; ending_current_ar: number;
  recovery_rate: number | null; dso: number | null; cei: number | null; avg_collection_days: number | null;
  invoices_paid: number; promises_made: number; promises_fulfilled: number; promises_broken: number;
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const { supabase, org } = ctx;
  const entitlements = await getEntitlements();
  const advanced = entitlements.limits.advanced_analytics === true;
  const days = PERIODS.includes(Number(param(sp.days))) ? Number(param(sp.days)) : 90;
  const { currency, available } = await resolveCurrency(ctx, param(sp.currency));
  const money = (v: number | string) => formatMoney(v, currency);

  const summary = await loadSummary(ctx, currency);
  const to = summary.today;
  const from = addDays(to, -(days - 1));
  const [trend, customers, metricsRes, perfRes] = await Promise.all([
    loadTrend(ctx, currency, 12),
    loadCustomerStats(ctx, currency),
    supabase.rpc("collection_metrics", { p_org: org.id, p_currency: currency, p_from: from, p_to: to }),
    advanced ? supabase.rpc("reminder_performance", { p_org: org.id, p_from: from, p_to: to }) : Promise.resolve({ data: [] }),
  ]);
  const m = metricsRes.data as Metrics | null;
  const perf = (perfRes.data ?? []) as { stage: string; tone: string; channel: string; sent: number; paid_within_7d: number; failed: number }[];
  const trendRange = trend.length ? `${formatMonth(trend[0].month)} – ${formatMonth(trend[trend.length - 1].month)}` : "";
  const insights = advanced ? buildInsights(summary, customers, trend, { money, trendRange }) : [];
  const range = `${formatDate(from)} – ${formatDate(to)}`;
  const href = (o: { days?: number; currency?: string }) => {
    const d = o.days ?? days, c = o.currency ?? currency;
    const q = new URLSearchParams();
    if (d !== 90) q.set("days", String(d));
    if (c !== org.base_currency) q.set("currency", c);
    const s = q.toString();
    return s ? `/analytics?${s}` : "/analytics";
  };
  const hasData = summary.outstanding_count > 0 || (m?.invoiced ?? 0) > 0 || (m?.collected ?? 0) > 0 || trend.some((t) => t.invoiced > 0);

  const kpis = m ? [
    { label: "Total recovered", value: money(m.collected), formula: "Payments applied to invoices in the period" },
    { label: "Recovery rate", value: m.recovery_rate !== null ? `${m.recovery_rate}%` : "—", formula: "Collected ÷ (opening receivables + invoiced)" },
    { label: "Days sales outstanding", value: m.dso !== null ? `${m.dso} days` : "—", formula: `Closing receivables ÷ invoiced × ${days} days`, advanced: true },
    { label: "Collection effectiveness", value: m.cei !== null ? `${m.cei}%` : "—", formula: "(Opening + invoiced − closing) ÷ (opening + invoiced − closing not yet due)", advanced: true },
    { label: "Average collection period", value: m.avg_collection_days !== null ? `${m.avg_collection_days} days` : "—", formula: `Issue date to full payment, ${m.invoices_paid} invoices paid in the period` },
    { label: "Broken promises", value: `${m.promises_broken} of ${m.promises_made}`, formula: `${m.promises_fulfilled} kept in the period`, advanced: true },
  ] : [];

  return (
    <>
      <PageHeader title="Analytics" description={`Collections intelligence for ${range}, in ${currency}. Amounts in other currencies are reported separately, never converted.`}
        actions={<>
          {available.length > 1 ? <Tabs active={currency} tabs={available.map((c) => ({ key: c, label: c, href: href({ currency: c }) }))} /> : null}
          <Tabs active={String(days)} tabs={PERIODS.map((d) => ({ key: String(d), label: d === 365 ? "12 months" : `${d} days`, href: href({ days: d }) }))} />
        </>} />

      {!hasData ? (
        <Card><EmptyState icon={BarChart3} title="No receivables data yet" description="Analytics are calculated from your invoices and recorded payments. Add invoices to see recovery rate, DSO, ageing and reminder performance."
          action={<Button asChild><Link href="/invoices">Go to invoices</Link></Button>} /></Card>
      ) : (
        <>
          <Card>
            <dl className="grid grid-cols-2 divide-line lg:grid-cols-3 lg:divide-x [&>div]:border-b [&>div]:border-line lg:[&>div:nth-child(n+4)]:border-b-0">
              {kpis.map((k) => (
                <div key={k.label} className="px-5 py-4">
                  <dt className="flex items-center gap-2 text-[13px] text-muted">{k.label}{k.advanced && !advanced ? <Badge>Growth plan</Badge> : null}</dt>
                  <dd className={cn("mt-1.5 text-2xl font-semibold tabular", k.advanced && !advanced && "text-faint blur-[5px] select-none")} aria-hidden={k.advanced && !advanced}>{k.value}</dd>
                  <p className="mt-1 text-xs text-faint">{k.formula}</p>
                </div>
              ))}
            </dl>
          </Card>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Outstanding balance trend" description="Receivables at each month end and cash collected, last 12 months." />
              <CardBody><OutstandingChart currency={currency} data={trend.map((t) => ({ label: formatMonth(t.month), Outstanding: t.outstanding_end, Collected: t.collected }))} /></CardBody>
            </Card>
            <Card>
              <CardHeader title="Collection performance over time" description="Cash collected in a month as a share of the amount invoiced that month." />
              <CardBody><RateChart data={trend.map((t) => ({ label: formatMonth(t.month), rate: t.invoiced > 0 ? Math.round((t.collected / t.invoiced) * 1000) / 10 : null }))} /></CardBody>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-2">
              <CardHeader title="Ageing analysis" description={`Open balance as of ${formatDate(summary.today)}.`} />
              <div className="mt-4">
                <Table>
                  <thead><tr><Th>Bucket</Th><Th className="text-right">Invoices</Th><Th className="text-right">Amount</Th><Th className="text-right">Share</Th></tr></thead>
                  <tbody>
                    {AGEING_BUCKETS.map((b) => {
                      const bucket = summary.ageing[b.key] ?? { amount: 0, count: 0 };
                      return (
                        <Tr key={b.key}>
                          <Td><Link href={b.key === "not_due" ? "/invoices?view=open" : "/invoices?view=overdue&sort=days_overdue"} className="hover:text-brand-700">{b.label}{b.key !== "not_due" ? " overdue" : ""}</Link></Td>
                          <Td className="text-right tabular">{bucket.count}</Td>
                          <Td className="text-right font-medium tabular">{money(bucket.amount)}</Td>
                          <Td className="text-right text-muted tabular">{summary.outstanding > 0 ? `${Math.round((bucket.amount / summary.outstanding) * 100)}%` : "—"}</Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
            </Card>

            <Card className="lg:col-span-3">
              <CardHeader title="Reminder performance" description={`Reminders created ${range}. "Followed by payment" means a payment was recorded on the invoice within 7 days of sending. It shows correlation, not proof of cause.`} />
              {!advanced ? (
                <p className="px-5 pt-3 pb-5 text-sm text-muted">Reminder performance is part of the Growth plan. <Link href="/billing" className="font-medium text-brand-700 hover:underline">See plans</Link></p>
              ) : perf.length === 0 ? (
                <p className="px-5 pt-3 pb-5 text-sm text-muted">No reminders were sent in this period.</p>
              ) : (
                <div className="mt-4">
                  <Table>
                    <thead><tr><Th>Stage</Th><Th>Tone</Th><Th className="text-right">Sent</Th><Th className="text-right">Followed by payment</Th><Th className="text-right">Rate</Th><Th className="text-right">Failed</Th></tr></thead>
                    <tbody>
                      {perf.map((p) => (
                        <Tr key={`${p.stage}-${p.tone}-${p.channel}`}>
                          <Td>{p.stage}</Td><Td className="text-muted">{titleCase(p.tone)}</Td>
                          <Td className="text-right tabular">{p.sent}</Td><Td className="text-right tabular">{p.paid_within_7d}</Td>
                          <Td className="text-right font-medium tabular">{p.sent > 0 ? `${Math.round((p.paid_within_7d / p.sent) * 100)}%` : "—"}</Td>
                          <Td className={cn("text-right tabular", p.failed > 0 && "text-danger-700")}>{p.failed}</Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeader title="Insights" description={`Rule-based observations from your own records. Receivables as of ${formatDate(summary.today)}; payment-delay comparisons use the last 180 days.`} />
            {!advanced ? (
              <p className="px-5 pt-3 pb-5 text-sm text-muted">Insights are part of the Growth plan. <Link href="/billing" className="font-medium text-brand-700 hover:underline">See plans</Link></p>
            ) : insights.length === 0 ? (
              <EmptyState icon={Lightbulb} title="Nothing unusual right now" description="Insights appear when customers build up old overdue invoices, start paying more slowly, miss promises, or when collections drop." className="py-10" />
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {insights.map((i) => (
                  <li key={i.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                          <Badge tone={i.severity === "critical" ? "red" : i.severity === "warning" ? "amber" : "blue"}>{titleCase(i.severity)}</Badge>{i.title}
                        </p>
                        <p className="mt-1 text-[13px] text-muted">{i.detail}</p>
                      </div>
                      {i.href ? <Button size="sm" variant="secondary" asChild><Link href={i.href}>View records</Link></Button> : null}
                    </div>
                    <dl className="mt-3 flex flex-wrap gap-2">
                      {i.evidence.map((e) => (
                        <div key={e.label} className="rounded-lg border border-line bg-subtle px-2.5 py-1.5 text-xs"><dt className="inline text-muted">{e.label}: </dt><dd className="inline font-medium tabular">{e.value}</dd></div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="mt-4">
            <CardHeader title="Customer payment behaviour" description="Customers with an open balance, highest risk first." />
            {customers.length === 0 ? <p className="px-5 pt-3 pb-5 text-sm text-muted">No customers with an open balance.</p> : (
              <div className="mt-4">
                <Table>
                  <thead><tr><Th>Customer</Th><Th>Risk</Th><Th className="text-right">Outstanding</Th><Th className="text-right">Overdue</Th><Th className="text-right">Oldest overdue</Th><Th className="text-right">Avg days late</Th><Th className="text-right">Broken promises</Th></tr></thead>
                  <tbody>
                    {customers.slice(0, 15).map((c) => (
                      <Tr key={c.customer_id}>
                        <Td><Link href={`/customers/${c.customer_id}`} className="font-medium hover:text-brand-700">{c.customer_name}</Link></Td>
                        <Td><StatusBadge status={c.risk_level} /></Td>
                        <Td className="text-right font-medium tabular">{money(c.outstanding)}</Td>
                        <Td className={cn("text-right tabular", c.overdue > 0 ? "text-danger-700" : "text-muted")}>{money(c.overdue)}</Td>
                        <Td className="text-right tabular">{c.max_days_overdue > 0 ? `${c.max_days_overdue} days` : "—"}</Td>
                        <Td className="text-right tabular">{c.avg_days_late ?? "—"}</Td>
                        <Td className="text-right tabular">{c.broken_promises}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
