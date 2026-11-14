import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Plus, Search } from "lucide-react";
import { CsvImportDialog } from "@/components/app/csv-import";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, PageHeader, Pagination, Tabs } from "@/components/ui/misc";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { requireContext } from "@/lib/auth/context";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import type { Customer, CustomerStats } from "@/lib/types";
import { param } from "@/lib/utils";
import { importCustomers } from "./actions";
import { CustomerDialog } from "./customer-form";

export const metadata: Metadata = { title: "Customers" };
const PAGE_SIZE = 25;

const SAMPLE = "name,email,phone,currency,payment_terms_days,tax_id,billing_address,notes\r\nGlobex Pvt Ltd,accounts@globex.example,+91 98765 43210,INR,30,27AAAAA0000A1Z5,\"12 MG Road, Pune\",Prefers email\r\n";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { supabase, org, role } = await requireContext();
  const q = (param(sp.q) ?? "").trim();
  const view = param(sp.view) === "archived" ? "archived" : "active";
  const page = Math.max(1, Number(param(sp.page)) || 1);
  const canEdit = can(role, "accountant");

  let query = supabase.from("customers").select("*", { count: "exact" }).eq("organisation_id", org.id);
  query = view === "archived" ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  if (q) {
    const term = q.replace(/[%_,()]/g, " ");
    query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%`);
  }
  const { data, count, error } = await query.order("name").range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) throw new Error(error.message);
  const customers = (data ?? []) as Customer[];

  const { data: statRows } = customers.length
    ? await supabase.from("customer_stats").select("*").in("customer_id", customers.map((c) => c.id))
    : { data: [] };
  const stats = new Map<string, CustomerStats>();
  for (const row of (statRows ?? []) as CustomerStats[]) {
    const current = stats.get(row.customer_id);
    if (!current || row.outstanding > current.outstanding) stats.set(row.customer_id, row);
  }

  const href = (overrides: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { q: q || undefined, view: view === "archived" ? "archived" : undefined, ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    const s = next.toString();
    return s ? `/customers?${s}` : "/customers";
  };

  return (
    <>
      <PageHeader
        title="Customers"
        description="Everyone you invoice, with their balance and payment behaviour."
        actions={canEdit ? (
          <>
            <CsvImportDialog
              title="Import customers"
              description="Customers whose name already exists are skipped, so re-importing a file is safe."
              action={importCustomers}
              sample={SAMPLE}
              columns={[
                { name: "name", required: true }, { name: "email" }, { name: "phone" }, { name: "currency", note: `defaults to ${org.base_currency}` },
                { name: "payment_terms_days", note: "defaults to 30" }, { name: "tax_id" }, { name: "billing_address" }, { name: "notes" },
              ]}
            />
            <CustomerDialog defaultCurrency={org.base_currency} trigger={<Button><Plus />Add customer</Button>} />
          </>
        ) : null}
      />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          <Tabs active={view} tabs={[
            { key: "active", label: "Active", href: href({ view: undefined, page: undefined }) },
            { key: "archived", label: "Archived", href: href({ view: "archived", page: undefined }) },
          ]} />
          <form className="relative w-full sm:w-72" action="/customers">
            {view === "archived" ? <input type="hidden" name="view" value="archived" /> : null}
            <Search className="pointer-events-none absolute top-3 left-3 size-4 text-faint" />
            <Input name="q" defaultValue={q} placeholder="Search name or email" className="pl-9" aria-label="Search customers" />
          </form>
        </div>
        {customers.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={q ? "No customers match your search" : view === "archived" ? "No archived customers" : "Add your first customer"}
            description={q ? "Try a different name or email address." : "Add customers one at a time or import your existing list from a CSV file."}
            action={!q && canEdit && view === "active" ? <CustomerDialog defaultCurrency={org.base_currency} trigger={<Button><Plus />Add customer</Button>} /> : undefined}
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr><Th>Customer</Th><Th>Terms</Th><Th className="text-right">Open invoices</Th><Th className="text-right">Outstanding</Th><Th className="text-right">Overdue</Th><Th className="text-right">Avg days late</Th><Th>Risk</Th></tr>
              </thead>
              <tbody>
                {customers.map((c) => {
                  const s = stats.get(c.id);
                  return (
                    <Tr key={c.id}>
                      <Td>
                        <Link href={`/customers/${c.id}`} className="font-medium text-ink hover:text-brand-700">{c.name}</Link>
                        <p className="text-xs text-muted">{c.email ?? "No email on file"}</p>
                      </Td>
                      <Td className="text-muted">Net {c.payment_terms_days}</Td>
                      <Td className="text-right tabular">{s?.open_invoice_count ?? 0}</Td>
                      <Td className="text-right font-medium tabular">{formatMoney(s?.outstanding ?? 0, s?.currency ?? c.currency)}</Td>
                      <Td className={`text-right tabular ${s && s.overdue > 0 ? "text-danger-700" : "text-muted"}`}>{formatMoney(s?.overdue ?? 0, s?.currency ?? c.currency)}</Td>
                      <Td className="text-right text-muted tabular">{s?.avg_days_late ?? "—"}</Td>
                      <Td>{s && s.outstanding > 0 ? <StatusBadge status={s.risk_level} /> : <span className="text-xs text-faint">No open balance</span>}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} hrefFor={(p) => href({ page: String(p) })} />
          </>
        )}
      </Card>
    </>
  );
}
