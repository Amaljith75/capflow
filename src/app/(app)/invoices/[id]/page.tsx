import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArchiveRestore, BellRing, Ban, ChevronLeft, CircleSlash, HandCoins, Handshake, Pause, Pencil, Play, Send, ShieldQuestion, Trash2 } from "lucide-react";
import { ActionButton } from "@/components/ui/action-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DefinitionList, Notice } from "@/components/ui/misc";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { getEntitlements, requireContext } from "@/lib/auth/context";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { describeEvent } from "@/lib/timeline";
import type { AuditLog, InvoiceItem, InvoiceRow, PaymentPromise, Reminder, Template } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PAYMENT_METHODS } from "@/lib/validation/schemas";
import { cancelPromise, transitionInvoice } from "../actions";
import { AttachmentPanel, DisputeDialog, PromiseDialog, ReminderDialog } from "./invoice-actions";

export const metadata: Metadata = { title: "Invoice" };

const DOT: Record<string, string> = { neutral: "bg-line-strong", green: "bg-brand-600", red: "bg-danger-600", amber: "bg-warn-700", blue: "bg-info-700" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, org, role } = await requireContext();
  const { data: row } = await supabase.from("invoice_ledger").select("*").eq("id", id).eq("organisation_id", org.id).maybeSingle();
  if (!row) notFound();
  const invoice = row as InvoiceRow;

  const [entitlements, itemsRes, allocRes, promiseRes, workflowRes, remindersRes, logsRes, templatesRes, customerRes] = await Promise.all([
    getEntitlements(),
    supabase.from("invoice_items").select("*").eq("invoice_id", id).order("position"),
    supabase.from("payment_allocations").select("id, amount, payments(id, payment_date, method, reference, voided_at)").eq("invoice_id", id).order("created_at"),
    supabase.from("payment_promises").select("*").eq("invoice_id", id).order("created_at", { ascending: false }).limit(5),
    supabase.from("recovery_workflows").select("status, status_reason, attempts_count, last_action_at").eq("invoice_id", id).maybeSingle(),
    supabase.from("reminders").select("*").eq("invoice_id", id).in("status", ["pending_approval", "scheduled"]).order("scheduled_for").limit(5),
    supabase.from("audit_logs").select("*").eq("invoice_id", id).order("created_at", { ascending: false }).limit(60),
    supabase.from("communication_templates").select("*").eq("organisation_id", org.id).eq("channel", "email").order("created_at"),
    supabase.from("customers").select("email, email_opt_out").eq("id", invoice.customer_id).maybeSingle(),
  ]);
  const items = (itemsRes.data ?? []) as InvoiceItem[];
  const allocations = (allocRes.data ?? []) as unknown as { id: string; amount: number; payments: { id: string; payment_date: string; method: string; reference: string | null; voided_at: string | null } }[];
  const promises = (promiseRes.data ?? []) as PaymentPromise[];
  const pendingPromise = promises.find((p) => p.status === "pending");
  const workflow = workflowRes.data;
  const upcoming = (remindersRes.data ?? []) as Reminder[];
  const logs = (logsRes.data ?? []) as AuditLog[];
  const templates = (templatesRes.data ?? []) as Template[];

  const money = (v: unknown) => formatMoney(v as number, invoice.currency);
  const canEdit = can(role, "accountant");
  const archived = invoice.archived_at !== null;
  const open = invoice.status === "sent" || invoice.status === "partially_paid";
  const editable = canEdit && !archived && invoice.status !== "paid" && invoice.status !== "cancelled";
  const canRemind = open && !archived && Boolean(customerRes.data?.email) && !customerRes.data?.email_opt_out;
  const t = (transition: Parameters<typeof transitionInvoice>[1]) => transitionInvoice.bind(null, id, transition, undefined);

  return (
    <>
      <Link href="/invoices" className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-ink"><ChevronLeft className="size-4" />Invoices</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{invoice.invoice_number}</h1>
            <StatusBadge status={invoice.effective_status} />
            {invoice.days_overdue > 0 && invoice.is_open ? <Badge tone="red">{invoice.days_overdue} days overdue</Badge> : null}
            {archived ? <Badge>Archived</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-muted">
            <Link href={`/customers/${invoice.customer_id}`} className="font-medium text-ink-soft hover:text-brand-700">{invoice.customer_name}</Link>
            {" · "}Issued {formatDate(invoice.issue_date)} · Due {formatDate(invoice.due_date)}
          </p>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            {archived ? (
              <ActionButton variant="secondary" action={t("restore")}><ArchiveRestore />Restore</ActionButton>
            ) : (
              <>
                {invoice.status === "draft" ? <ActionButton action={t("send")}><Send />Mark as sent</ActionButton> : null}
                {open ? <Button asChild><Link href={`/payments?record=1&invoice=${id}`}><HandCoins />Record payment</Link></Button> : null}
                {canRemind ? (
                  <ReminderDialog invoiceId={id} templates={templates} canSendNow={can(role, "finance_manager")} trigger={<Button variant="secondary"><BellRing />Send reminder</Button>}
                    vars={{
                      customer_name: invoice.customer_name, invoice_number: invoice.invoice_number, amount_outstanding: money(invoice.amount_outstanding),
                      invoice_total: money(invoice.total), due_date: formatDate(invoice.due_date), days_overdue: String(invoice.days_overdue),
                      organisation_name: org.name, payment_reference: invoice.payment_reference ?? invoice.invoice_number,
                    }} />
                ) : null}
                {open && !pendingPromise && entitlements.limits.promise_tracking ? (
                  <PromiseDialog invoiceId={id} outstanding={Number(invoice.amount_outstanding).toFixed(2)} today={invoice.today} trigger={<Button variant="secondary"><Handshake />Record promise</Button>} />
                ) : null}
                {editable ? <Button variant="secondary" asChild><Link href={`/invoices/${id}/edit`}><Pencil />Edit</Link></Button> : null}
                {open ? <DisputeDialog invoiceId={id} trigger={<Button variant="secondary"><ShieldQuestion />Dispute</Button>} /> : null}
                {invoice.status === "disputed" ? <ActionButton action={t("resolve_dispute")}><Play />Resolve dispute</ActionButton> : null}
                {open ? (
                  invoice.recovery_paused
                    ? <ActionButton variant="secondary" action={t("resume")}><Play />Resume recovery</ActionButton>
                    : <ActionButton variant="secondary" action={t("pause")}><Pause />Pause recovery</ActionButton>
                ) : null}
                {invoice.status === "sent" || invoice.status === "draft" ? (
                  <ActionButton variant="secondary" action={t("cancel")}
                    confirm={{ title: "Cancel this invoice?", description: "It will no longer count as a receivable and recovery stops. This cannot be undone.", confirmLabel: "Cancel invoice", danger: true }}>
                    <Ban />Cancel
                  </ActionButton>
                ) : null}
                {invoice.status === "draft" && !invoice.sent_at ? (
                  <ActionButton variant="danger-outline" action={t("delete")} redirectTo="/invoices"
                    confirm={{ title: "Delete this draft?", description: "Drafts that were never sent can be deleted permanently.", confirmLabel: "Delete draft", danger: true }}>
                    <Trash2 />Delete
                  </ActionButton>
                ) : (
                  <ActionButton variant="secondary" action={t("archive")}
                    confirm={{ title: "Archive this invoice?", description: "It is hidden from lists and reports and recovery stops. Its history is kept and it can be restored.", confirmLabel: "Archive" }}>
                    <Archive />Archive
                  </ActionButton>
                )}
              </>
            )}
          </div>
        ) : null}
      </div>

      {invoice.status === "disputed" ? (
        <div className="mb-4"><Notice tone="warn" title="This invoice is disputed">{invoice.dispute_reason ?? "No reason recorded."} Automated reminders are stopped until someone resolves the dispute.</Notice></div>
      ) : null}
      {open && !canRemind && !archived ? (
        <div className="mb-4"><Notice tone="info">Reminders cannot be emailed for this invoice because the customer {customerRes.data?.email ? "has opted out of email" : "has no billing email"}.</Notice></div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <dl className="grid grid-cols-2 divide-line md:grid-cols-4 md:divide-x">
              {[
                { label: "Total", value: money(invoice.total) },
                { label: "Paid", value: money(invoice.amount_paid) },
                { label: "Outstanding", value: money(invoice.amount_outstanding), strong: true },
                { label: invoice.status === "paid" ? "Paid on" : "Due date", value: formatDate(invoice.status === "paid" ? invoice.paid_on : invoice.due_date) },
              ].map((f) => (
                <div key={f.label} className="px-5 py-4">
                  <dt className="text-xs text-muted">{f.label}</dt>
                  <dd className={cn("mt-1 text-lg tabular", f.strong ? "font-semibold" : "font-medium")}>{f.value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Line items" />
            <div className="mt-4">
              <Table>
                <thead><tr><Th>Description</Th><Th className="text-right">Qty</Th><Th className="text-right">Unit price</Th><Th className="text-right">Tax</Th><Th className="text-right">Amount</Th></tr></thead>
                <tbody>
                  {items.map((i) => (
                    <Tr key={i.id}>
                      <Td>{i.description}</Td>
                      <Td className="text-right tabular">{Number(i.quantity)}</Td>
                      <Td className="text-right tabular">{money(i.unit_price)}</Td>
                      <Td className="text-right text-muted tabular">{money(i.tax_amount)}{i.tax_rate !== null ? ` (${Number(i.tax_rate)}%)` : ""}</Td>
                      <Td className="text-right font-medium tabular">{money(i.line_total)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <dl className="ml-auto w-full max-w-xs space-y-1.5 border-t border-line px-5 py-4 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular">{money(invoice.subtotal)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Tax</dt><dd className="tabular">{money(invoice.tax_total)}</dd></div>
              <div className="flex justify-between font-semibold"><dt>Total</dt><dd className="tabular">{money(invoice.total)}</dd></div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Payments" description="Verified payments allocated to this invoice." />
            {allocations.length === 0 ? (
              <p className="px-5 pt-2 pb-5 text-sm text-muted">No payments recorded yet.</p>
            ) : (
              <div className="mt-4">
                <Table>
                  <thead><tr><Th>Date</Th><Th>Method</Th><Th>Reference</Th><Th className="text-right">Applied</Th></tr></thead>
                  <tbody>
                    {allocations.map((a) => (
                      <Tr key={a.id} className={a.payments.voided_at ? "opacity-60" : ""}>
                        <Td>{formatDate(a.payments.payment_date)}</Td>
                        <Td className="text-muted">{PAYMENT_METHODS[a.payments.method] ?? a.payments.method}</Td>
                        <Td className="text-muted">{a.payments.reference ?? "—"}{a.payments.voided_at ? <Badge tone="red" className="ml-2">Voided</Badge> : null}</Td>
                        <Td className={cn("text-right font-medium tabular", a.payments.voided_at && "line-through")}>{money(a.amount)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DefinitionList items={[
                { label: "Payment reference", value: invoice.payment_reference ?? "—" },
                { label: "Currency", value: invoice.currency },
                { label: "Marked as sent", value: formatDateTime(invoice.sent_at, org.timezone) },
                { label: "Notes", value: invoice.notes ?? "—" },
              ]} />
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Recovery" action={workflow ? <StatusBadge status={workflow.status} /> : <Badge>Not started</Badge>} />
            <CardBody className="flex flex-col gap-4 text-sm">
              <p className="text-muted">
                {workflow?.status_reason
                  ?? (workflow?.status === "active" ? "The reminder sequence is running for this invoice."
                    : invoice.status === "draft" ? "Recovery starts when the invoice is marked as sent." : "No recovery workflow.")}
              </p>
              {workflow ? <p className="text-xs text-faint">{workflow.attempts_count} reminder{workflow.attempts_count === 1 ? "" : "s"} sent{workflow.last_action_at ? ` · last on ${formatDateTime(workflow.last_action_at, org.timezone)}` : ""}</p> : null}
              {upcoming.map((r) => (
                <div key={r.id} className="rounded-xl border border-line bg-subtle p-3">
                  <div className="flex items-center justify-between gap-2"><p className="font-medium">{r.stage}</p><StatusBadge status={r.status} /></div>
                  <p className="mt-1 text-xs text-muted">{r.status === "scheduled" ? `Sends ${formatDateTime(r.scheduled_for, org.timezone)}` : "Waiting for approval"} · <Link href="/recovery" className="font-medium text-brand-700 hover:underline">Review</Link></p>
                </div>
              ))}
              {pendingPromise ? (
                <div className="rounded-xl border border-warn-100 bg-warn-50 p-3">
                  <p className="font-medium text-warn-700">Promise of {money(pendingPromise.promised_amount)} by {formatDate(pendingPromise.promised_date)}</p>
                  {pendingPromise.notes ? <p className="mt-1 text-xs text-ink-soft">{pendingPromise.notes}</p> : null}
                  {canEdit ? <ActionButton size="sm" variant="secondary" className="mt-2" action={cancelPromise.bind(null, pendingPromise.id)}><CircleSlash />Cancel promise</ActionButton> : null}
                </div>
              ) : null}
              {promises.filter((p) => p.status !== "pending").map((p) => (
                <p key={p.id} className="flex items-center justify-between gap-2 text-xs text-muted">
                  <span>Promise of {money(p.promised_amount)} by {formatDate(p.promised_date)}</span><StatusBadge status={p.status} />
                </p>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Attachment" />
            <CardBody><AttachmentPanel invoiceId={id} name={invoice.attachment_path ? invoice.attachment_name ?? "Invoice file" : null} canEdit={canEdit && !archived} /></CardBody>
          </Card>

          <Card>
            <CardHeader title="Activity timeline" description="Every change and automated action, newest first." />
            <CardBody>
              <ol className="relative space-y-5 before:absolute before:top-1.5 before:bottom-1.5 before:left-[5px] before:w-px before:bg-line">
                {logs.map((log) => {
                  const entry = describeEvent(log, money);
                  return (
                    <li key={log.id} className="relative pl-6">
                      <span className={cn("absolute top-1.5 left-0 size-[11px] rounded-full ring-4 ring-surface", DOT[entry.tone])} />
                      <p className="text-sm font-medium">{entry.title}</p>
                      {entry.detail ? <p className="text-[13px] text-muted">{entry.detail}</p> : null}
                      <p className="text-xs text-faint">{formatDateTime(log.created_at, org.timezone)} · {log.actor_type === "system" ? "Capflow automation" : "Team member"}</p>
                    </li>
                  );
                })}
              </ol>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
