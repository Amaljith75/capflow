import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileText, Plus, Search } from "lucide-react";
import { CsvImportDialog } from "@/components/app/csv-import";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, PageHeader, Pagination, Tabs } from "@/components/ui/misc";
import { getEntitlements, requireContext } from "@/lib/auth/context";
import { can } from "@/lib/permissions";
import type { InvoiceRow } from "@/lib/types";
import { param } from "@/lib/utils";
import { importInvoices } from "./actions";
import { InvoiceTable } from "./invoice-table";

export const metadata: Metadata = { title: "Invoices" };
const PAGE_SIZE = 25;
const SORTABLE = ["invoice_number", "customer_name", "issue_date", "due_date", "days_overdue", "total", "amount_outstanding"];
const VIEWS = ["all", "open", "overdue", "draft", "paid", "disputed", "archived"] as const;
type View = (typeof VIEWS)[number];

const SAMPLE = "invoice_number,customer,customer_email,issue_date,due_date,amount,tax,currency,notes,status\r\nINV-1001,Globex Pvt Ltd,accounts@globex.example,2026-10-01,2026-10-31,50000.00,9000.00,INR,October retainer,sent\r\n";

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { supabase, org, role } = await requireContext();
  const entitlements = await getEntitlements();
  const view = (VIEWS as readonly string[]).includes(param(sp.view) ?? "") ? (param(sp.view) as View) : "all";
  const q = (param(sp.q) ?? "").trim();
  const sort = SORTABLE.includes(param(sp.sort) ?? "") ? param(sp.sort)! : "due_date";
  const dir = param(sp.dir) === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number(param(sp.page)) || 1);
  const canEdit = can(role, "accountant");

  let query = supabase.from("invoice_ledger").select("*", { count: "exact" }).eq("organisation_id", org.id);
  query = view === "archived" ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  if (view === "open") query = query.eq("is_open", true);
  if (view === "overdue") query = query.eq("is_open", true).gt("days_overdue", 0);
  if (view === "draft" || view === "paid" || view === "disputed") query = query.eq("status", view);
  if (q) {
    const term = q.replace(/[%_,()]/g, " ");
    query = query.or(`invoice_number.ilike.%${term}%,customer_name.ilike.%${term}%`);
  }
  const { data, count, error } = await query
    .order(sort, { ascending: dir === "asc" }).order("id")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as InvoiceRow[];

  const href = (overrides: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = {
      view: view === "all" ? undefined : view, q: q || undefined,
      sort: sort === "due_date" ? undefined : sort, dir: dir === "desc" ? undefined : dir, ...overrides,
    };
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    const s = next.toString();
    return s ? `/invoices?${s}` : "/invoices";
  };
  const sortHrefs = Object.fromEntries(SORTABLE.map((column) => [
    column, href({ sort: column, dir: sort === column && dir === "desc" ? "asc" : "desc", page: undefined }),
  ]));

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Every invoice you are owed, with its balance and recovery status."
        actions={
          <>
            <Button variant="secondary" asChild><a href="/api/export/invoices"><Download />Export CSV</a></Button>
            {canEdit ? (
              <>
                <CsvImportDialog
                  title="Import invoices"
                  description="Invoice numbers that already exist are skipped. Unknown customers are created."
                  action={importInvoices}
                  sample={SAMPLE}
                  columns={[
                    { name: "invoice_number", required: true }, { name: "customer", required: true, note: "name" },
                    { name: "due_date", required: true, note: "YYYY-MM-DD or DD/MM/YYYY" }, { name: "amount", required: true, note: "before tax" },
                    { name: "tax", note: "tax amount" }, { name: "issue_date" }, { name: "currency" }, { name: "customer_email" }, { name: "notes" }, { name: "status", note: "draft or sent" },
                  ]}
                />
                <Button asChild><Link href="/invoices/new"><Plus />New invoice</Link></Button>
              </>
            ) : null}
          </>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          <Tabs active={view} tabs={VIEWS.map((v) => ({ key: v, label: v[0].toUpperCase() + v.slice(1), href: href({ view: v === "all" ? undefined : v, page: undefined }) }))} />
          <form className="relative w-full sm:w-72" action="/invoices">
            {view !== "all" ? <input type="hidden" name="view" value={view} /> : null}
            <Search className="pointer-events-none absolute top-3 left-3 size-4 text-faint" />
            <Input name="q" defaultValue={q} placeholder="Search number or customer" className="pl-9" aria-label="Search invoices" />
          </form>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={q || view !== "all" ? "No invoices match these filters" : "No invoices yet"}
            description={q || view !== "all" ? "Try another view or clear the search." : "Create your first invoice or import your open receivables from a CSV file to start recovery."}
            action={!q && view === "all" && canEdit ? <Button asChild><Link href="/invoices/new"><Plus />New invoice</Link></Button> : undefined}
          />
        ) : (
          <>
            <InvoiceTable rows={rows} canEdit={canEdit} bulkEnabled={entitlements.limits.bulk_operations === true} sort={{ sort, dir, hrefs: sortHrefs }} />
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} hrefFor={(p) => href({ page: String(p) })} />
          </>
        )}
      </Card>
    </>
  );
}
