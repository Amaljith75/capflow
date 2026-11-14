import type { Metadata } from "next";
import { Check, CreditCard, Receipt } from "lucide-react";
import { ActionButton } from "@/components/ui/action-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice, PageHeader, Tabs } from "@/components/ui/misc";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { getEntitlements, requireContext } from "@/lib/auth/context";
import { listRazorpayInvoices, providerForCurrency, providerStatus } from "@/lib/billing/providers";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import type { Plan, PlanLimits } from "@/lib/types";
import { cn, param, titleCase } from "@/lib/utils";
import { cancelSubscription, openBillingPortal, startCheckout } from "./actions";

export const metadata: Metadata = { title: "Billing" };

function features(e: PlanLimits): string[] {
  const n = (v: number | null, unit: string) => (v === null ? `Unlimited ${unit}` : `${v.toLocaleString("en-IN")} ${unit}`);
  return [
    n(e.max_users, e.max_users === 1 ? "user" : "users"), `${n(e.max_invoices_per_month, "invoices")} / month`, `${n(e.max_reminders_per_month, "reminders")} / month`,
    ...(e.ai_reminders ? ["AI-personalised reminders"] : []), ...(e.promise_tracking ? ["Payment promise tracking"] : []),
    ...(e.whatsapp ? ["WhatsApp and SMS channels"] : []), ...(e.advanced_analytics ? ["Advanced analytics and insights"] : ["Basic analytics"]),
    ...(e.bulk_operations ? ["Bulk operations and team permissions"] : []),
  ];
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { supabase, org, role } = await requireContext();
  const entitlements = await getEntitlements();
  const isOwner = can(role, "owner");
  const interval = param(sp.interval) === "annual" ? "annual" : "monthly";
  const priceCurrency = org.base_currency === "INR" ? "INR" : "USD";
  const provider = providerForCurrency(priceCurrency);
  const checkoutReady = providerStatus()[provider];

  const [{ data: plans }, { data: sub }, { data: events }] = await Promise.all([
    supabase.from("subscription_plans").select("*").order("sort_order"),
    supabase.from("subscriptions").select("*").eq("organisation_id", org.id).maybeSingle(),
    supabase.from("audit_logs").select("action, metadata, created_at").eq("organisation_id", org.id).like("action", "subscription.%").order("created_at", { ascending: false }).limit(20),
  ]);
  let invoices: { id: string; amount: number; currency: string; status: string; date: number; url: string | null }[] = [];
  if (sub?.provider === "razorpay" && sub.provider_subscription_id) {
    invoices = await listRazorpayInvoices(sub.provider_subscription_id).catch(() => []);
  }
  const usage = entitlements.usage;
  const limits = entitlements.limits;
  const meters = [
    { label: "Invoices this month", used: usage.invoices_this_month, limit: limits.max_invoices_per_month ?? null },
    { label: "Reminders sent this month", used: usage.reminders_this_month, limit: limits.max_reminders_per_month ?? null },
    { label: "Team members", used: usage.users, limit: limits.max_users ?? null },
  ];

  return (
    <>
      <PageHeader title="Billing" description="Your Capflow plan, usage and payment history." />
      {param(sp.checkout) === "success" ? <div className="mb-4"><Notice tone="success" title="Payment received">Your plan updates as soon as the payment provider confirms the subscription, usually within a minute.</Notice></div> : null}
      {param(sp.checkout) === "cancelled" ? <div className="mb-4"><Notice tone="info">Checkout was cancelled. Nothing was charged.</Notice></div> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Current plan" action={<StatusBadge status={entitlements.status} />} />
          <CardBody>
            <p className="text-2xl font-semibold tracking-tight">{entitlements.plan_id ? titleCase(entitlements.plan_id) : "No plan"}</p>
            <p className="mt-1 text-sm text-muted">
              {entitlements.status === "trialing" && entitlements.trial_ends_at ? `Free trial ends ${formatDateTime(entitlements.trial_ends_at, org.timezone)}.` : null}
              {entitlements.current_period_end ? ` ${entitlements.cancel_at_period_end ? "Cancels" : "Renews"} on ${formatDate(entitlements.current_period_end.slice(0, 10))}.` : null}
              {entitlements.billing_interval ? ` Billed ${entitlements.billing_interval} via ${titleCase(entitlements.provider ?? "")}.` : null}
            </p>
            {isOwner ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {sub?.provider === "stripe" && sub.provider_customer_id ? <ActionButton variant="secondary" action={openBillingPortal}><CreditCard />Manage payment method and invoices</ActionButton> : null}
                {sub?.provider === "razorpay" && sub.provider_subscription_id && !sub.cancel_at_period_end && sub.status !== "cancelled" ? (
                  <ActionButton variant="danger-outline" action={cancelSubscription} confirm={{ title: "Cancel your subscription?", description: "You keep access until the end of the current billing period. Your data stays available to view and export.", confirmLabel: "Cancel subscription", danger: true }}>Cancel subscription</ActionButton>
                ) : null}
              </div>
            ) : <p className="mt-4 text-xs text-muted">Only owners can change the plan.</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Usage" />
          <CardBody className="flex flex-col gap-4">
            {meters.map((m) => (
              <div key={m.label}>
                <div className="flex justify-between text-sm"><span className="text-ink-soft">{m.label}</span><span className="font-medium tabular">{m.used}{m.limit !== null ? ` / ${m.limit}` : ""}</span></div>
                {m.limit !== null ? <div className="mt-1.5 h-1.5 rounded-full bg-subtle"><div className={cn("h-1.5 rounded-full", m.used >= m.limit ? "bg-danger-600" : "bg-brand-600")} style={{ width: `${Math.min(100, (m.used / Math.max(1, m.limit)) * 100)}%` }} /></div> : null}
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      <div className="mt-8 mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Plans</h2>
        <Tabs active={interval} tabs={[{ key: "monthly", label: "Monthly", href: "/billing" }, { key: "annual", label: "Annual (2 months free)", href: "/billing?interval=annual" }]} />
      </div>
      {!checkoutReady ? <div className="mb-4"><Notice tone="info">Online checkout is not configured on this server ({provider === "stripe" ? "STRIPE_SECRET_KEY" : "RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET"} missing). Plans are shown for reference.</Notice></div> : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {((plans ?? []) as Plan[]).map((plan) => {
          const price = plan.prices?.[priceCurrency]?.[interval];
          const current = entitlements.plan_id === plan.id && entitlements.status !== "trialing";
          const highlighted = plan.id === "growth";
          return (
            <Card key={plan.id} className={cn("flex flex-col p-5", highlighted && "border-brand-600 ring-1 ring-brand-600")}>
              <div className="flex items-center justify-between"><h3 className="text-base font-semibold">{plan.name}</h3>{highlighted ? <Badge tone="green">Most popular</Badge> : null}</div>
              <p className="mt-1 min-h-10 text-[13px] text-muted">{plan.description}</p>
              <p className="mt-4 text-3xl font-semibold tracking-tight tabular">
                {price !== undefined ? formatMoney((price / 100).toFixed(2), priceCurrency).replace(/\.00$/, "") : "Custom"}
                {price !== undefined ? <span className="text-sm font-normal text-muted">/{interval === "annual" ? "year" : "month"}</span> : null}
              </p>
              <ul className="mt-4 flex flex-1 flex-col gap-2 text-[13px]">
                {features(plan.entitlements).map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-brand-600" />{f}</li>)}
              </ul>
              <div className="mt-5">
                {current ? <Badge tone="dark" className="w-full justify-center py-2">Current plan</Badge>
                  : price === undefined ? <a href="mailto:sales@capflow.app?subject=Capflow%20Enterprise" className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-line-strong text-sm font-medium hover:bg-subtle">Contact sales</a>
                  : isOwner ? <ActionButton className="w-full" variant={highlighted ? "primary" : "secondary"} disabled={!checkoutReady} action={startCheckout.bind(null, plan.id, interval)}>Choose {plan.name}</ActionButton>
                  : null}
              </div>
            </Card>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted">Prices exclude applicable taxes. Payments are processed by {provider === "stripe" ? "Stripe" : "Razorpay"}; Capflow never sees or stores your card details.</p>

      <Card className="mt-8">
        <CardHeader title="Billing history" />
        {invoices.length > 0 ? (
          <div className="mt-4"><Table>
            <thead><tr><Th>Date</Th><Th>Invoice</Th><Th>Status</Th><Th className="text-right">Amount</Th></tr></thead>
            <tbody>{invoices.map((i) => (
              <Tr key={i.id}><Td>{formatDate(new Date(i.date * 1000).toISOString().slice(0, 10))}</Td><Td>{i.url ? <a href={i.url} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">{i.id}</a> : i.id}</Td><Td><Badge>{titleCase(i.status)}</Badge></Td><Td className="text-right tabular">{formatMoney((i.amount / 100).toFixed(2), i.currency)}</Td></Tr>
            ))}</tbody>
          </Table></div>
        ) : (events ?? []).length > 0 ? (
          <ul className="mt-3 divide-y divide-line">{(events ?? []).map((e, i) => (
            <li key={i} className="flex justify-between px-5 py-3 text-sm"><span>{titleCase(e.action.replace("subscription.", ""))}{(e.metadata as { plan_id?: string }).plan_id ? ` · ${titleCase(String((e.metadata as { plan_id?: string }).plan_id))}` : ""}</span><span className="text-muted">{formatDateTime(e.created_at, org.timezone)}</span></li>
          ))}</ul>
        ) : (
          <div className="flex items-center gap-3 px-5 pt-3 pb-5 text-sm text-muted"><Receipt className="size-4" />No billing activity yet.{sub?.provider === "stripe" ? " Stripe invoices are available in the billing portal." : ""}</div>
        )}
      </Card>
    </>
  );
}
