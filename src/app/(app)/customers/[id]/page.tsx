import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArchiveRestore, Archive, ChevronLeft, FileText, MessagesSquare, Pencil, Plus } from "lucide-react";
import { ActionButton } from "@/components/ui/action-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DefinitionList, EmptyState } from "@/components/ui/misc";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { requireContext } from "@/lib/auth/context";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import type { Customer, CustomerStats, InvoiceRow, Payment } from "@/lib/types";
import { PAYMENT_METHODS } from "@/lib/validation/schemas";
import { setCustomerArchived } from "../actions";
import { CustomerDialog } from "../customer-form";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, org, role } = await requireContext();
  const { data: customerRow } = await supabase.from("customers").select("*").eq("id", id).eq("organisation_id", org.id).maybeSingle();
  if (!customerRow) notFound();
  const customer = customerRow as Customer;
  const canEdit = can(role, "accountant");

  const [statsRes, invoicesRes, paymentsRes, commsRes] = await Promise.all([
    supabase.from("customer_stats").select("*").eq("customer_id", id),
    supabase.from("invoice_ledger").select("*").eq("customer_id", id).is("archived_at", null).order("due_date", { ascending: false }).limit(50),
    supabase.from("payments").select("*").eq("customer_id", id).order("payment_date", { ascending: false }).limit(20),
    supabase.from("communication_logs").select("id, channel, subject, status, sandbox, to_address, created_at, invoice_id").eq("customer_id", id).order("created_at", { ascending: false }).limit(20),
  ]);
  const allStats = (statsRes.data ?? []) as CustomerStats[];
  const stats = allStats.find((s) => s.currency === customer.currency) ?? allStats[0];
  const invoices = (invoicesRes.data ?? []) as InvoiceRow[];
  const payments = (paymentsRes.data ?? []) as Payment[];
  const comms = commsRes.data ?? [];
  const cur = stats?.currency ?? customer.currency;

  const figures = [
    { label: "Outstanding", value: formatMoney(stats?.outstanding ?? 0, cur) },
    { label: "Overdue", value: formatMoney(stats?.overdue ?? 0, cur), danger: (stats?.overdue ?? 0) > 0 },
    { label: "Total invoiced", value: formatMoney(stats?.total_invoiced ?? 0, cur) },
    { label: "Invoices", value: `${stats?.invoice_count ?? 0} (${stats?.open_invoice_count ?? 0} open)` },
    { label: "Average payment delay", value: stats?.avg_days_late != null ? `${stats.avg_days_late} days late` : "No paid invoices yet" },
  ];

  return (
    <>
      <Link href="/customers" className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-ink"><ChevronLeft className="size-4" />Customers</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{customer.name}</h1>
            {customer.archived_at ? <Badge>Archived</Badge> : null}
            {stats && stats.outstanding > 0 ? <StatusBadge status={stats.risk_level} /> : null}
          </div>
          <p className="mt-1 text-sm text-muted">{customer.email ?? "No billing email"} · Net {customer.payment_terms_days} · {customer.currency}</p>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <CustomerDialog customer={customer} defaultCurrency={org.base_currency} trigger={<Button variant="secondary"><Pencil />Edit</Button>} />
            {customer.archived_at ? (
              <ActionButton variant="secondary" action={setCustomerArchived.bind(null, customer.id, false)}><ArchiveRestore />Restore</ActionButton>
            ) : (
              <>
                <ActionButton
                  variant="secondary"
                  action={setCustomerArchived.bind(null, customer.id, true)}
                  confirm={{ title: "Archive this customer?", description: "Their history is kept, but they are hidden from lists and cannot be invoiced until restored.", confirmLabel: "Archive customer" }}
                ><Archive />Archive</ActionButton>
                <Button asChild><Link href={`/invoices/new?customer=${customer.id}`}><Plus />New invoice</Link></Button>
              </>
            )}
          </div>
        ) : null}
      </div>

      <Card className="mb-4">
        <dl className="grid grid-cols-2 divide-line md:grid-cols-5 md:divide-x">
          {figures.map((f) => (
            <div key={f.label} className="px-5 py-4">
              <dt className="text-xs text-muted">{f.label}</dt>
              <dd className={`mt-1 text-lg font-semibold tabular ${f.danger ? "text-danger-700" : ""}`}>{f.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader title="Invoices" description="Most recent 50, newest due date first." />
            {invoices.length === 0 ? (
              <EmptyState icon={FileText} title="No invoices yet" description="Invoices you create for this customer appear here." />
            ) : (
              <div className="mt-4">
                <Table>
                  <thead><tr><Th>Invoice</Th><Th>Due</Th><Th>Status</Th><Th className="text-right">Total</Th><Th className="text-right">Outstanding</Th></tr></thead>
                  <tbody>
                    {invoices.map((i) => (
                      <Tr key={i.id}>
                        <Td><Link href={`/invoices/${i.id}`} className="font-medium hover:text-brand-700">{i.invoice_number}</Link></Td>
                        <Td className="text-muted">{formatDate(i.due_date)}{i.days_overdue > 0 ? <span className="ml-2 text-xs text-danger-700">{i.days_overdue}d overdue</span> : null}</Td>
                        <Td><StatusBadge status={i.effective_status} /></Td>
                        <Td className="text-right tabular">{formatMoney(i.total, i.currency)}</Td>
                        <Td className="text-right font-medium tabular">{formatMoney(i.amount_outstanding, i.currency)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Payment history" />
            {payments.length === 0 ? (
              <p className="px-5 pt-2 pb-5 text-sm text-muted">No payments recorded for this customer.</p>
            ) : (
              <div className="mt-4">
                <Table>
                  <thead><tr><Th>Date</Th><Th>Method</Th><Th>Reference</Th><Th className="text-right">Amount</Th></tr></thead>
                  <tbody>
                    {payments.map((p) => (
                      <Tr key={p.id} className={p.voided_at ? "opacity-60" : ""}>
                        <Td>{formatDate(p.payment_date)}</Td>
                        <Td className="text-muted">{PAYMENT_METHODS[p.method] ?? p.method}</Td>
                        <Td className="text-muted">{p.reference ?? "—"}{p.voided_at ? <Badge tone="red" className="ml-2">Voided</Badge> : null}</Td>
                        <Td className={`text-right font-medium tabular ${p.voided_at ? "line-through" : ""}`}>{formatMoney(p.amount, p.currency)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Communication history" description="Every reminder sent or attempted for this customer." />
            {comms.length === 0 ? (
              <EmptyState icon={MessagesSquare} title="No messages yet" description="Reminders sent to this customer are logged here with their delivery status." className="py-8" />
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {comms.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-4 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{m.subject ?? `${m.channel} message`}</p>
                      <p className="text-xs text-muted">{m.channel} to {m.to_address} · {formatDateTime(m.created_at, org.timezone)}</p>
                    </div>
                    <StatusBadge status={m.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DefinitionList className="sm:grid-cols-1" items={[
                { label: "Email", value: customer.email ?? "—" },
                { label: "Phone", value: customer.phone ?? "—" },
                { label: "Tax ID", value: customer.tax_id ?? "—" },
                { label: "Billing address", value: customer.billing_address ?? "—" },
                { label: "Last payment", value: formatDate(stats?.last_paid_on) },
                { label: "Email reminders", value: customer.email_opt_out ? "Opted out" : customer.email ? "Allowed" : "No address" },
                { label: "WhatsApp / SMS consent", value: `${customer.whatsapp_opt_in ? "WhatsApp opted in" : "No WhatsApp consent"} · ${customer.sms_opt_in ? "SMS opted in" : "No SMS consent"}` },
              ]} />
            </CardBody>
          </Card>
          {stats && stats.outstanding > 0 ? (
            <Card>
              <CardHeader title="Why this risk level" description="Rule-based score, not an AI or credit judgement." />
              <CardBody>
                <div className="mb-3 flex items-center gap-3"><StatusBadge status={stats.risk_level} /><span className="text-sm text-muted tabular">Score {stats.risk_score} / 100</span></div>
                <ul className="space-y-1.5 text-[13px] text-ink-soft">
                  <li>Oldest open invoice is {stats.max_days_overdue} days overdue</li>
                  <li>{formatMoney(stats.overdue, cur)} of {formatMoney(stats.outstanding, cur)} outstanding is overdue</li>
                  <li>{stats.avg_days_late != null ? `Pays ${stats.avg_days_late} days late on average` : "No payment history yet"}</li>
                  <li>{stats.broken_promises} broken payment promise{stats.broken_promises === 1 ? "" : "s"}</li>
                </ul>
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Internal notes" />
            <CardBody><p className="text-sm whitespace-pre-wrap text-ink-soft">{customer.notes ?? "No notes."}</p></CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
