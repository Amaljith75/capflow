import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/misc";
import { requireContext } from "@/lib/auth/context";
import { can } from "@/lib/permissions";
import type { InvoiceItem } from "@/lib/types";
import { InvoiceForm } from "../../invoice-form";

export const metadata: Metadata = { title: "Edit invoice" };

/** Trims trailing zeros from a DB numeric for display in an input: 2.000 → "2", 18.5000 → "18.5". */
function plain(value: number | null, decimals: number): string {
  if (value === null) return "";
  return Number(value).toFixed(decimals).replace(/\.?0+$/, "") || "0";
}

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, org, role } = await requireContext();
  if (!can(role, "accountant")) redirect(`/invoices/${id}`);
  const [{ data: invoice }, { data: items }, { data: customers }] = await Promise.all([
    supabase.from("invoices").select("*").eq("id", id).eq("organisation_id", org.id).maybeSingle(),
    supabase.from("invoice_items").select("*").eq("invoice_id", id).order("position"),
    supabase.from("customers").select("id, name, currency, payment_terms_days").eq("organisation_id", org.id).order("name").limit(2000),
  ]);
  if (!invoice) notFound();
  if (invoice.status === "paid" || invoice.status === "cancelled") redirect(`/invoices/${id}`);

  return (
    <>
      <Link href={`/invoices/${id}`} className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-ink"><ChevronLeft className="size-4" />Invoice {invoice.invoice_number}</Link>
      <PageHeader title={`Edit ${invoice.invoice_number}`} description={invoice.amount_paid > 0 ? "Payments exist on this invoice, so the customer and currency are locked and the total cannot drop below the amount paid." : undefined} />
      <InvoiceForm
        invoiceId={id}
        customers={customers ?? []}
        canSend={invoice.status === "draft"}
        defaults={{
          customer_id: invoice.customer_id, invoice_number: invoice.invoice_number, issue_date: invoice.issue_date, due_date: invoice.due_date,
          currency: invoice.currency, notes: invoice.notes ?? "", payment_reference: invoice.payment_reference ?? "",
          items: ((items ?? []) as InvoiceItem[]).map((i) => ({
            description: i.description, quantity: plain(i.quantity, 3), unit_price: Number(i.unit_price).toFixed(2),
            tax_rate: i.tax_rate !== null ? plain(i.tax_rate, 4) : "",
            // Imported lines carry a fixed tax amount with no rate; keep it unless a rate is entered.
            tax_amount: i.tax_rate === null && Number(i.tax_amount) > 0 ? Number(i.tax_amount).toFixed(2) : "",
          })),
        }}
      />
    </>
  );
}
