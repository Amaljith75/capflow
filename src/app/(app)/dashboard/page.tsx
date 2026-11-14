import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, CalendarClock, CircleAlert, FileText, HandCoins, Plus, TrendingUp, Upload, Users } from "lucide-react";
import { CashflowChart, OutstandingChart, RiskDonut } from "@/components/charts/charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Tabs } from "@/components/ui/misc";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { requireContext } from "@/lib/auth/context";
import { AGEING_BUCKETS, loadCustomerStats, loadSummary, loadTrend, resolveCurrency } from "@/lib/data/receivables";
import { formatDate, formatMonth } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { cn, param } from "@/lib/utils";
import { PAYMENT_METHODS } from "@/lib/validation/schemas";

export const metadata: Metadata = { title: "Overview" };

function greeting(timeZone: string): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone }).format(new Date()));
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const { supabase, org, user, role } = ctx;
  const { currency, available } = await resolveCurrency(ctx, param(sp.currency));
  const money = (v: number | string) => formatMoney(v, currency);

  const [summary, trend, customers, promisesRes, paymentsRes, invoiceCount] = await Promise.all([
    loadSummary(ctx, currency),
    loadTrend(ctx, currency, 6),
    loadCustomerStats(ctx, currency),
    supabase.from("payment_promises").select("id, promised_amount, promised_date, invoice_id, invoices!inner(invoice_number, currency), customers(name)")
      .eq("organisation_id", org.id).eq("status", "pending").eq("invoices.currency", currency).order("promised_date").limit(5),
    supabase.from("payments").select("id, amount, currency, payment_date, method, reference, customers(id, name)")
      .eq("organisation_id", org.id).eq("currency", currency).is("voided_at", null).order("payment_date", { ascending: false }).order("created_at", { ascending: false }).limit(6),
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("organisation_id", org.id),
  ]);
  const promises = (promisesRes.data ?? []) as unknown as { id: string; promised_amount: number; promised_date: string; invoice_id: string; invoices: { invoice_number: string }; customers: { name: string } | null }[];
  const payments = (paymentsRes.data ?? []) as unknown as { id: string; amount: number; currency: string; payment_date: string; method: string; reference: string | null; customers: { id: string; name: string } | null }[];
  const isNew = (invoiceCount.count ?? 0) === 0;
  const highRisk = customers.filter((c) => c.risk_level === "high").slice(0, 5);
  const risk = (["low", "medium", "high"] as const).map((level) => {
    const group = customers.filter((c) => c.risk_level === level);
    return { name: level[0].toUpperCase() + level.slice(1), value: group.reduce((s, c) => s + c.outstanding, 0), customers: group.length };
  });
  const ageingMax = Math.max(1, ...AGEING_BUCKETS.map((b) => summary.ageing[b.key]?.amount ?? 0));

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{greeting(org.timezone)}{user.fullName ? `, ${user.fullName.split(" ")[0]}` : ""}</h1>
          <p className="mt-1 text-sm text-muted">Receivables for {org.name} as of {formatDate(summary.today)}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {available.length > 1 ? (
            <Tabs active={currency} tabs={available.map((c) => ({ key: c, label: c, href: c === org.base_currency ? "/dashboard" : `/dashboard?currency=${c}` }))} />
          ) : null}
          {can(role, "accountant") ? <Button asChild><Link href="/invoices/new"><Plus />New invoice</Link></Button> : null}
        </div>
      </div>

      {isNew ? (
        <Card className="mb-4 overflow-hidden">
          <div className="grid gap-6 p-6 md:grid-cols-[1.2fr_1fr] md:p-8">
            <div>
              <p className="text-xs font-medium tracking-wide text-brand-700 uppercase">Getting started</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight">Bring in the invoices you are waiting to be paid for</h2>
              <p className="mt-2 max-w-md text-sm text-muted">Once your open invoices are in Capflow, this page shows what is outstanding and overdue, and the recovery sequence starts following up for you.</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button asChild><Link href="/invoices"><Upload />Import invoices from CSV</Link></Button>
                <Button variant="secondary" asChild><Link href="/customers"><Users />Add a customer</Link></Button>
              </div>
            </div>
            <ol className="space-y-3 text-sm">
              {["Add or import your customers", "Add or import open invoices and mark them as sent", "Review the reminder sequence under Automations", "Approve the first reminders in Recovery"].map((step, i) => (
                <li key={step} className="flex items-center gap-3 rounded-xl border border-line bg-subtle px-4 py-3">
                  <span className="flex size-6 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">{i + 1}</span>{step}
                </li>
              ))}
            </ol>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="hero-card flex flex-col justify-between rounded-card p-5 text-white shadow-card">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20"><FileText className="size-[18px]" /></span>
              <div><p className="text-sm font-medium">Outstanding receivables</p><p className="text-xs text-white/65">{summary.outstanding_count} open invoice{summary.outstanding_count === 1 ? "" : "s"}</p></div>
            </div>
          </div>
          <p className="mt-6 text-3xl font-semibold tracking-tight tabular">{money(summary.outstanding)}</p>
          <Link href="/invoices?view=open" className="mt-4 flex items-center justify-between border-t border-white/15 pt-3 text-[13px] text-white/85 hover:text-white">See open invoices<ArrowRight className="size-4" /></Link>
        </div>
        {[
          { icon: CircleAlert, title: "Overdue", note: `${summary.overdue_count} invoice${summary.overdue_count === 1 ? "" : "s"} past due`, value: money(summary.overdue), href: "/invoices?view=overdue&sort=days_overdue", link: "Review overdue", danger: summary.overdue > 0 },
          { icon: HandCoins, title: "Recovered this month", note: `${money(summary.recovered_past_due_this_month)} of it was past due`, value: money(summary.recovered_this_month), href: "/payments", link: "View payments", danger: false },
        ].map((k) => (
          <Card key={k.title} className="flex flex-col justify-between p-5">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl border border-line bg-subtle"><k.icon className={cn("size-[18px]", k.danger ? "text-danger-600" : "text-brand-700")} /></span>
              <div><p className="text-sm font-medium">{k.title}</p><p className="text-xs text-muted">{k.note}</p></div>
            </div>
            <p className={cn("mt-6 text-3xl font-semibold tracking-tight tabular", k.danger && "text-danger-700")}>{k.value}</p>
            <Link href={k.href} className="mt-4 flex items-center justify-between border-t border-line pt-3 text-[13px] text-ink-soft hover:text-brand-700">{k.link}<ArrowRight className="size-4" /></Link>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <dl className="grid grid-cols-2 divide-line lg:grid-cols-4 lg:divide-x">
          {[
            { icon: CalendarClock, label: "Due this week", value: money(summary.due_this_week), note: `${summary.due_this_week_count} invoice${summary.due_this_week_count === 1 ? "" : "s"} in the next 7 days` },
            { icon: TrendingUp, label: "Collection rate", value: summary.collection_rate_90d !== null ? `${summary.collection_rate_90d}%` : "—", note: "Paid share of invoices issued in the last 90 days" },
            { icon: ArrowUpRight, label: "Average days to payment", value: summary.avg_days_to_pay !== null ? `${summary.avg_days_to_pay} days` : "—", note: "Issue date to full payment, last 180 days" },
            { icon: CircleAlert, label: "Disputed", value: String(summary.disputed_count), note: "Invoices waiting for human review" },
          ].map((s) => (
            <div key={s.label} className="px-5 py-4">
              <dt className="flex items-center gap-2 text-[13px] text-muted"><s.icon className="size-4" />{s.label}</dt>
              <dd className="mt-1.5 text-xl font-semibold tabular">{s.value}</dd>
              <p className="mt-0.5 text-xs text-faint">{s.note}</p>
            </div>
          ))}
        </dl>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader title="Invoice ageing" description="Outstanding balance by days past due." action={<Link href="/analytics" className="text-[13px] font-medium text-brand-700 hover:underline">Analytics</Link>} />
          <CardBody className="flex flex-col gap-3.5">
            {AGEING_BUCKETS.map((b, index) => {
              const bucket = summary.ageing[b.key] ?? { amount: 0, count: 0 };
              return (
                <div key={b.key}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-ink-soft">{b.label}<span className="ml-2 text-xs text-faint">{bucket.count}</span></span>
                    <span className="font-medium tabular">{money(bucket.amount)}</span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full bg-subtle">
                    <div className={cn("h-2 rounded-full", ["bg-brand-300", "bg-brand-500", "bg-warn-700/70", "bg-danger-600/70", "bg-danger-700"][index])}
                      style={{ width: `${bucket.amount > 0 ? Math.max(3, (bucket.amount / ageingMax) * 100) : 0}%` }} />
                  </div>
                </div>
              );
            })}
          </CardBody>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader title="Cash flow" description="Invoiced versus collected, last 6 months." />
          <CardBody>
            {trend.every((t) => t.invoiced === 0 && t.collected === 0) ? (
              <p className="flex h-[280px] items-center justify-center text-sm text-muted">Invoiced and collected amounts appear here once you have activity.</p>
            ) : (
              <CashflowChart currency={currency} data={trend.map((t) => ({ label: formatMonth(t.month), Invoiced: t.invoiced, Collected: t.collected }))} />
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Outstanding versus recovered" description="Receivables balance at each month end against cash collected in the month." />
          <CardBody>
            {trend.every((t) => t.outstanding_end === 0 && t.collected === 0) ? (
              <p className="flex h-[260px] items-center justify-center text-sm text-muted">No receivables history yet.</p>
            ) : (
              <OutstandingChart currency={currency} data={trend.map((t) => ({ label: formatMonth(t.month), Outstanding: t.outstanding_end, Collected: t.collected }))} />
            )}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Customer risk" description="Open balance by rule-based risk level." />
          <CardBody>
            {customers.length === 0 ? <p className="py-10 text-center text-sm text-muted">No customers with an open balance.</p> : <RiskDonut data={risk} currency={currency} />}
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="High-risk customers" description="Old overdue invoices, slow payment history or broken promises." />
          {highRisk.length === 0 ? (
            <p className="px-5 pt-3 pb-5 text-sm text-muted">No customers are currently rated high risk.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {highRisk.map((c) => (
                <li key={c.customer_id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <Link href={`/customers/${c.customer_id}`} className="truncate text-sm font-medium hover:text-brand-700">{c.customer_name}</Link>
                    <p className="text-xs text-muted">Oldest invoice {c.max_days_overdue} days overdue{c.broken_promises ? ` · ${c.broken_promises} broken promise${c.broken_promises === 1 ? "" : "s"}` : ""}</p>
                  </div>
                  <span className="text-sm font-semibold text-danger-700 tabular">{money(c.overdue)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Upcoming payment promises" action={<Link href="/recovery?tab=promises" className="text-[13px] font-medium text-brand-700 hover:underline">All promises</Link>} />
          {promises.length === 0 ? (
            <p className="px-5 pt-3 pb-5 text-sm text-muted">No pending promises. Record one from an invoice when a customer commits to a date.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {promises.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <Link href={`/invoices/${p.invoice_id}`} className="text-sm font-medium hover:text-brand-700">{p.customers?.name ?? "Customer"} · {p.invoices.invoice_number}</Link>
                    <p className="text-xs text-muted">Expected {formatDate(p.promised_date)}</p>
                  </div>
                  <span className="text-sm font-semibold tabular">{money(p.promised_amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Recent payment activity" action={<Link href="/payments" className="text-[13px] font-medium text-brand-700 hover:underline">All payments</Link>} />
        {payments.length === 0 ? (
          <p className="px-5 pt-3 pb-5 text-sm text-muted">Payments you record appear here.</p>
        ) : (
          <div className="mt-4">
            <Table>
              <thead><tr><Th>Customer</Th><Th>Date</Th><Th>Method</Th><Th>Reference</Th><Th>Status</Th><Th className="text-right">Amount</Th></tr></thead>
              <tbody>
                {payments.map((p) => (
                  <Tr key={p.id}>
                    <Td className="font-medium">{p.customers ? <Link href={`/customers/${p.customers.id}`} className="hover:text-brand-700">{p.customers.name}</Link> : "—"}</Td>
                    <Td className="text-muted">{formatDate(p.payment_date)}</Td>
                    <Td className="text-muted">{PAYMENT_METHODS[p.method] ?? p.method}</Td>
                    <Td className="text-muted">{p.reference ?? "—"}</Td>
                    <Td><Badge tone="green" dot>Received</Badge></Td>
                    <Td className="text-right font-medium tabular">{formatMoney(p.amount, p.currency)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </>
  );
}
