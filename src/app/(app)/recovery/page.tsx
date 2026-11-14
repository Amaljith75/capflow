import type { Metadata } from "next";
import Link from "next/link";
import { BellRing, Check, CheckCheck, Handshake, Pencil, RotateCcw, ShieldAlert, X } from "lucide-react";
import { ActionButton } from "@/components/ui/action-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, Notice, PageHeader, Tabs } from "@/components/ui/misc";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { getEntitlements, requireContext } from "@/lib/auth/context";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import type { Reminder } from "@/lib/types";
import { param, titleCase } from "@/lib/utils";
import { cancelPromise, clearFollowUp } from "../invoices/actions";
import { approveAllReminders, decideReminder, deEscalate } from "./actions";
import { AiDraftButton, EditReminderDialog } from "./recovery-dialogs";

export const metadata: Metadata = { title: "Recovery" };

type ReminderRow = Reminder & { invoices: { invoice_number: string; currency: string; amount_outstanding: number; due_date: string } | null; customers: { name: string; email: string | null } | null };
const SELECT = "*, invoices(invoice_number, currency, amount_outstanding, due_date), customers(name, email)";

export default async function RecoveryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { supabase, org, role } = await requireContext();
  const entitlements = await getEntitlements();
  const tab = ["approvals", "scheduled", "attention", "promises", "history"].includes(param(sp.tab) ?? "") ? param(sp.tab)! : "approvals";
  const isManager = can(role, "finance_manager");
  const canEdit = can(role, "accountant");

  const [pending, scheduled, failed, workflows, promises, history, ai, jobs] = await Promise.all([
    supabase.from("reminders").select(SELECT).eq("organisation_id", org.id).eq("status", "pending_approval").order("created_at").limit(100),
    supabase.from("reminders").select(SELECT).eq("organisation_id", org.id).in("status", ["scheduled", "sending"]).order("scheduled_for").limit(100),
    supabase.from("reminders").select(SELECT).eq("organisation_id", org.id).eq("status", "failed").order("updated_at", { ascending: false }).limit(50),
    supabase.from("recovery_workflows").select("id, status, status_reason, escalated_at, updated_at, invoice_id, invoices!inner(invoice_number, currency, amount_outstanding, due_date, archived_at, customers(name))")
      .eq("organisation_id", org.id).in("status", ["escalated", "human_review"]).is("invoices.archived_at", null).order("updated_at", { ascending: false }).limit(100),
    supabase.from("payment_promises").select("*, invoices(invoice_number, currency), customers(name)").eq("organisation_id", org.id).order("promised_date", { ascending: false }).limit(100),
    tab === "history"
      ? supabase.from("reminders").select(SELECT).eq("organisation_id", org.id).in("status", ["sent", "cancelled", "skipped"]).order("updated_at", { ascending: false }).limit(100)
      : Promise.resolve({ data: [] }),
    supabase.from("integration_configs").select("enabled").eq("organisation_id", org.id).eq("kind", "ai").maybeSingle(),
    supabase.from("background_jobs").select("payload, status, last_error").eq("organisation_id", org.id).eq("job_type", "ai_draft_reminder").order("created_at", { ascending: false }).limit(50),
  ]);
  const pendingRows = (pending.data ?? []) as ReminderRow[];
  const scheduledRows = (scheduled.data ?? []) as ReminderRow[];
  const failedRows = (failed.data ?? []) as ReminderRow[];
  const historyRows = (history.data ?? []) as ReminderRow[];
  const attention = (workflows.data ?? []) as unknown as { id: string; status: string; status_reason: string | null; invoice_id: string; invoices: { invoice_number: string; currency: string; amount_outstanding: number; due_date: string; customers: { name: string } | null } }[];
  const promiseRows = (promises.data ?? []) as unknown as { id: string; invoice_id: string; promised_amount: number; promised_date: string; status: string; notes: string | null; follow_up_date: string | null; invoices: { invoice_number: string; currency: string } | null; customers: { name: string } | null }[];
  const followUps = promiseRows.filter((p) => p.status === "broken" && p.follow_up_date);
  const jobFor = (id: string) => (jobs.data ?? []).find((j) => (j.payload as { reminder_id?: string }).reminder_id === id);
  const aiReason = !entitlements.limits.ai_reminders ? "AI personalisation is not included in your plan" : !ai.data?.enabled ? "Enable the AI integration first" : undefined;
  const overdueQueue = scheduledRows.some((r) => new Date(r.scheduled_for).getTime() < Date.now() - 15 * 60_000);

  const href = (t: string) => (t === "approvals" ? "/recovery" : `/recovery?tab=${t}`);
  const reminderCard = (r: ReminderRow, actions: React.ReactNode) => (
    <li key={r.id} className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/invoices/${r.invoice_id}`} className="text-sm font-semibold hover:text-brand-700">{r.customers?.name} · {r.invoices?.invoice_number}</Link>
            <Badge>{r.stage}</Badge><Badge tone="blue">{titleCase(r.tone)}</Badge>
            {r.generated_by === "ai" ? <Badge tone="green">AI draft</Badge> : null}
          </div>
          <p className="mt-1 text-xs text-muted">
            {r.invoices ? `${formatMoney(r.invoices.amount_outstanding, r.invoices.currency)} outstanding · due ${formatDate(r.invoices.due_date)} · ` : ""}
            {r.channel} to {r.customers?.email ?? "no address"}
            {r.status === "scheduled" ? ` · sends ${formatDateTime(r.scheduled_for, org.timezone)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">{actions}</div>
      </div>
      <div className="mt-3 rounded-xl border border-line bg-subtle p-4">
        <p className="text-sm font-medium">{r.subject}</p>
        <p className="mt-2 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-soft">{r.body}</p>
      </div>
      {r.last_error ? <p className="mt-2 text-xs text-danger-700">Last error: {r.last_error}</p> : null}
      {(() => {
        const job = jobFor(r.id);
        if (!job || r.status !== "pending_approval") return null;
        if (job.status === "queued" || job.status === "running") return <p className="mt-2 text-xs text-info-700">AI draft in progress. Refresh in a moment.</p>;
        if (job.status === "failed" || job.status === "dead") return <p className="mt-2 text-xs text-danger-700">AI draft failed: {job.last_error ?? "unknown error"}. The template text above is unchanged.</p>;
        return null;
      })()}
    </li>
  );

  return (
    <>
      <PageHeader title="Recovery" description="Review what Capflow is about to send, what needs a person, and every promise customers have made."
        actions={isManager && pendingRows.length > 1 && tab === "approvals" ? (
          <ActionButton action={approveAllReminders} confirm={{ title: `Approve all ${pendingRows.length} reminders?`, description: "They will be sent within your configured working hours.", confirmLabel: "Approve all" }}><CheckCheck />Approve all</ActionButton>
        ) : null} />
      {overdueQueue ? (
        <div className="mb-4"><Notice tone="warn" title="Scheduled reminders are waiting for the background worker">Approved reminders are sent by the Capflow worker service. Messages are past their send time, so check that the worker is deployed and running (see the README).</Notice></div>
      ) : null}
      <div className="mb-4">
        <Tabs active={tab} tabs={[
          { key: "approvals", label: "Needs approval", href: href("approvals"), count: pendingRows.length },
          { key: "scheduled", label: "Scheduled", href: href("scheduled"), count: scheduledRows.length },
          { key: "attention", label: "Needs attention", href: href("attention"), count: attention.length + failedRows.length + followUps.length },
          { key: "promises", label: "Promises", href: href("promises") },
          { key: "history", label: "History", href: href("history") },
        ]} />
      </div>

      {tab === "approvals" ? (
        <Card>
          {pendingRows.length === 0 ? (
            <EmptyState icon={BellRing} title="Nothing waiting for approval" description="When an invoice reaches a step in your reminder sequence, the drafted message appears here for review. In automatic mode, messages skip this queue." />
          ) : (
            <ul className="divide-y divide-line">
              {pendingRows.map((r) => reminderCard(r, (
                <>
                  {canEdit ? <AiDraftButton reminderId={r.id} tone={r.tone} disabledReason={aiReason} /> : null}
                  {isManager ? (
                    <>
                      <EditReminderDialog reminder={r} trigger={<Button size="sm" variant="secondary"><Pencil />Edit</Button>} />
                      <ActionButton size="sm" variant="secondary" action={decideReminder.bind(null, r.id, "cancel")}><X />Skip</ActionButton>
                      <ActionButton size="sm" action={decideReminder.bind(null, r.id, "approve")}><Check />Approve</ActionButton>
                    </>
                  ) : <span className="text-xs text-muted">A finance manager approves reminders</span>}
                </>
              )))}
            </ul>
          )}
        </Card>
      ) : null}

      {tab === "scheduled" ? (
        <Card>
          {scheduledRows.length === 0 ? (
            <EmptyState icon={BellRing} title="No reminders scheduled" description="Approved reminders wait here until their send time inside your working hours." />
          ) : (
            <ul className="divide-y divide-line">
              {scheduledRows.map((r) => reminderCard(r, isManager && r.status === "scheduled" ? <ActionButton size="sm" variant="secondary" action={decideReminder.bind(null, r.id, "cancel")}><X />Cancel</ActionButton> : <StatusBadge status={r.status} />))}
            </ul>
          )}
        </Card>
      ) : null}

      {tab === "attention" ? (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Escalated and disputed invoices" description="Automation has stopped here. A person needs to decide the next step." />
            {attention.length === 0 ? <p className="px-5 pt-3 pb-5 text-sm text-muted">No invoices are escalated or in dispute.</p> : (
              <div className="mt-4"><Table>
                <thead><tr><Th>Invoice</Th><Th>Customer</Th><Th>State</Th><Th>Why</Th><Th className="text-right">Outstanding</Th><Th /></tr></thead>
                <tbody>
                  {attention.map((w) => (
                    <Tr key={w.id}>
                      <Td><Link href={`/invoices/${w.invoice_id}`} className="font-medium hover:text-brand-700">{w.invoices.invoice_number}</Link></Td>
                      <Td>{w.invoices.customers?.name}</Td>
                      <Td><StatusBadge status={w.status} /></Td>
                      <Td className="max-w-xs text-[13px] text-muted">{w.status_reason}</Td>
                      <Td className="text-right font-medium tabular">{formatMoney(w.invoices.amount_outstanding, w.invoices.currency)}</Td>
                      <Td className="text-right">{w.status === "escalated" && isManager ? <ActionButton size="sm" variant="secondary" action={deEscalate.bind(null, w.id)}>Clear escalation</ActionButton> : <Button size="sm" variant="ghost" asChild><Link href={`/invoices/${w.invoice_id}`}>Open</Link></Button>}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table></div>
            )}
          </Card>
          <Card>
            <CardHeader title="Broken promises to follow up" description="The promised date passed with no verified payment." />
            {followUps.length === 0 ? <p className="px-5 pt-3 pb-5 text-sm text-muted">No follow-ups due.</p> : (
              <ul className="mt-3 divide-y divide-line">
                {followUps.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div><Link href={`/invoices/${p.invoice_id}`} className="text-sm font-medium hover:text-brand-700">{p.customers?.name} · {p.invoices?.invoice_number}</Link>
                      <p className="text-xs text-muted">Promised {formatMoney(p.promised_amount, p.invoices?.currency ?? org.base_currency)} by {formatDate(p.promised_date)}</p></div>
                    {canEdit ? <ActionButton size="sm" variant="secondary" action={clearFollowUp.bind(null, p.id)}><Check />Followed up</ActionButton> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Failed reminders" description="These were not delivered. Fix the cause, then retry." />
            {failedRows.length === 0 ? <p className="px-5 pt-3 pb-5 text-sm text-muted">No failed reminders.</p> : (
              <ul className="mt-3 divide-y divide-line">{failedRows.map((r) => reminderCard(r, isManager ? <ActionButton size="sm" variant="secondary" action={decideReminder.bind(null, r.id, "retry")}><RotateCcw />Retry</ActionButton> : null))}</ul>
            )}
          </Card>
        </div>
      ) : null}

      {tab === "promises" ? (
        <Card>
          {!entitlements.limits.promise_tracking ? (
            <EmptyState icon={Handshake} title="Promise tracking is part of the Growth plan" description="Record customer payment commitments, pause reminders until the promised date, and get follow-up tasks when a promise is missed."
              action={<Button asChild><Link href="/billing">See plans</Link></Button>} />
          ) : promiseRows.length === 0 ? (
            <EmptyState icon={Handshake} title="No payment promises yet" description="When a customer commits to a payment date, record it from the invoice page. Capflow pauses reminders and checks whether the payment arrives." />
          ) : (
            <Table>
              <thead><tr><Th>Invoice</Th><Th>Customer</Th><Th>Expected</Th><Th>Status</Th><Th>Notes</Th><Th className="text-right">Promised</Th><Th /></tr></thead>
              <tbody>
                {promiseRows.map((p) => (
                  <Tr key={p.id}>
                    <Td><Link href={`/invoices/${p.invoice_id}`} className="font-medium hover:text-brand-700">{p.invoices?.invoice_number}</Link></Td>
                    <Td>{p.customers?.name}</Td>
                    <Td className="whitespace-nowrap text-muted">{formatDate(p.promised_date)}</Td>
                    <Td><StatusBadge status={p.status} /></Td>
                    <Td className="max-w-xs truncate text-[13px] text-muted">{p.notes ?? "—"}</Td>
                    <Td className="text-right font-medium tabular">{formatMoney(p.promised_amount, p.invoices?.currency ?? org.base_currency)}</Td>
                    <Td className="text-right">{p.status === "pending" && canEdit ? <ActionButton size="sm" variant="ghost" action={cancelPromise.bind(null, p.id)}>Cancel</ActionButton> : null}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      ) : null}

      {tab === "history" ? (
        <Card>
          {historyRows.length === 0 ? (
            <EmptyState icon={ShieldAlert} title="No reminder history yet" description="Sent, skipped and cancelled reminders are listed here." />
          ) : (
            <Table>
              <thead><tr><Th>Invoice</Th><Th>Customer</Th><Th>Stage</Th><Th>Tone</Th><Th>Status</Th><Th>When</Th></tr></thead>
              <tbody>
                {historyRows.map((r) => (
                  <Tr key={r.id}>
                    <Td><Link href={`/invoices/${r.invoice_id}`} className="font-medium hover:text-brand-700">{r.invoices?.invoice_number}</Link></Td>
                    <Td>{r.customers?.name}</Td><Td className="text-muted">{r.stage}</Td><Td className="text-muted">{titleCase(r.tone)}</Td>
                    <Td><StatusBadge status={r.status} />{r.status !== "sent" && r.last_error ? <span className="ml-2 text-xs text-muted">{r.last_error}</span> : null}</Td>
                    <Td className="whitespace-nowrap text-muted">{formatDateTime(r.sent_at ?? r.created_at, org.timezone)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      ) : null}
    </>
  );
}
