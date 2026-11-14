import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Search, Wallet } from "lucide-react";
import { CsvImportDialog } from "@/components/app/csv-import";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, PageHeader, Pagination } from "@/components/ui/misc";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { requireContext } from "@/lib/auth/context";
import { formatDate, todayIn } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { param } from "@/lib/utils";
import { PAYMENT_METHODS } from "@/lib/validation/schemas";
import { importPayments } from "./actions";
import { RecordPaymentDialog, VoidPaymentDialog } from "./payment-dialogs";

export const metadata: Metadata = { title: "Payments" };
const PAGE_SIZE = 25;
const SAMPLE = "invoice_number,amount,payment_date,reference,method,notes\r\nINV-1001,25000.00,2026-11-05,UTR229384756,bank_transfer,Part payment\r\n";

interface PaymentRow {
  id: string; amount: number; currency: string; payment_date: string; method: string; reference: string | null; source: string;
  voided_at: string | null; void_reason: string | null;
  customers: { id: string; name: string };
  payment_allocations: { amount: number; invoices: { id: string; invoice_number: string } }[];
}

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { supabase, org, role } = await requireContext();
  const q = (param(sp.q) ?? "").trim();
  const page = Math.max(1, Number(param(sp.page)) || 1);
  const canEdit = can(role, "accountant");

  let query = supabase.from("payments")
    .select("id, amount, currency, payment_date, method, reference, source, voided_at, void_reason, customers!inner(id, name), payment_allocations(amount, invoices(id, invoice_number))", { count: "exact" })
    .eq("organisation_id", org.id);
  if (q) {
    query = query.ilike("reference", `%${q.replace(/[%_]/g, " ")}%`);
  }
  const [{ data, count, error }, { data: customers }] = await Promise.all([
    query.order("payment_date", { ascending: false }).order("created_at", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    canEdit ? supabase.from("customers").select("id, name, currency").eq("organisation_id", org.id).is("archived_at", null).order("name").limit(2000) : Promise.resolve({ data: [] }),
  ]);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as PaymentRow[];

  let initial: { customerId: string; invoiceId: string } | undefined;
  const invoiceParam = param(sp.invoice);
  if (invoiceParam && canEdit) {
    const { data: inv } = await supabase.from("invoices").select("id, customer_id").eq("id", invoiceParam).eq("organisation_id", org.id).maybeSingle();
    if (inv) initial = { customerId: inv.customer_id, invoiceId: inv.id };
  }

  return (
    <>
      <PageHeader
        title="Payments"
        description="An immutable ledger of money received. Corrections are made by voiding, never by editing."
        actions={canEdit ? (
          <>
            <CsvImportDialog
              title="Import payments"
              description="Each row is applied to the invoice it names. Re-importing the same file records nothing twice."
              action={importPayments}
              sample={SAMPLE}
              columns={[
                { name: "invoice_number", required: true }, { name: "amount", required: true }, { name: "payment_date", required: true, note: "YYYY-MM-DD or DD/MM/YYYY" },
                { name: "reference" }, { name: "method", note: "bank_transfer, upi, card, cash, cheque" }, { name: "notes" },
              ]}
            />
            <RecordPaymentDialog customers={customers ?? []} today={todayIn(org.timezone)} initial={initial} defaultOpen={param(sp.record) === "1"}
              trigger={<Button><Plus />Record payment</Button>} />
          </>
        ) : null}
      />
      <Card>
        <div className="flex justify-end border-b border-line p-4">
          <form className="relative w-full sm:w-72" action="/payments">
            <Search className="pointer-events-none absolute top-3 left-3 size-4 text-faint" />
            <Input name="q" defaultValue={q} placeholder="Search reference" className="pl-9" aria-label="Search payments" />
          </form>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={Wallet} title={q ? "No payments match your search" : "No payments recorded yet"}
            description={q ? "Try a different reference." : "When a customer pays, record it here and apply it to their invoices. Balances update automatically."} />
        ) : (
          <>
            <Table>
              <thead><tr><Th>Date</Th><Th>Customer</Th><Th>Applied to</Th><Th>Method</Th><Th>Reference</Th><Th className="text-right">Amount</Th><Th /></tr></thead>
              <tbody>
                {rows.map((p) => {
                  const applied = p.payment_allocations.reduce((s, a) => s + Number(a.amount), 0);
                  const unallocated = Number(p.amount) - applied;
                  return (
                    <Tr key={p.id} className={p.voided_at ? "opacity-60" : ""}>
                      <Td className="whitespace-nowrap">{formatDate(p.payment_date)}</Td>
                      <Td><Link href={`/customers/${p.customers.id}`} className="font-medium hover:text-brand-700">{p.customers.name}</Link></Td>
                      <Td className="text-[13px]">
                        {p.payment_allocations.length === 0 ? <span className="text-muted">Unallocated</span> : p.payment_allocations.map((a, i) => (
                          <span key={a.invoices.id}>{i > 0 ? ", " : ""}<Link href={`/invoices/${a.invoices.id}`} className="text-ink-soft hover:text-brand-700">{a.invoices.invoice_number}</Link></span>
                        ))}
                        {p.payment_allocations.length > 0 && unallocated > 0.004 ? <span className="text-muted"> · {formatMoney(unallocated.toFixed(2), p.currency)} unallocated</span> : null}
                      </Td>
                      <Td className="text-muted">{PAYMENT_METHODS[p.method] ?? p.method}{p.source === "csv_import" ? <Badge className="ml-2">CSV</Badge> : null}</Td>
                      <Td className="text-muted">{p.reference ?? "—"}</Td>
                      <Td className={`text-right font-medium whitespace-nowrap tabular ${p.voided_at ? "line-through" : ""}`}>{formatMoney(p.amount, p.currency)}</Td>
                      <Td className="text-right">
                        {p.voided_at ? <Badge tone="red">Voided</Badge> : can(role, "finance_manager") ? (
                          <VoidPaymentDialog paymentId={p.id} label={`${formatMoney(p.amount, p.currency)} from ${p.customers.name} on ${formatDate(p.payment_date)}`}
                            trigger={<Button size="sm" variant="ghost">Void</Button>} />
                        ) : null}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} hrefFor={(n) => `/payments?${new URLSearchParams({ ...(q ? { q } : {}), page: String(n) })}`} />
          </>
        )}
      </Card>
    </>
  );
}
