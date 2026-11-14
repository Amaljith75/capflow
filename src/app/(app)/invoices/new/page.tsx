import type { Metadata } from "next";
import Link from "next/link";
import { Building2, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { requireContext } from "@/lib/auth/context";
import { addDays, todayIn } from "@/lib/dates";
import { param } from "@/lib/utils";
import { InvoiceForm } from "../invoice-form";

export const metadata: Metadata = { title: "New invoice" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { supabase, org } = await requireContext();
  const { data: customers } = await supabase.from("customers").select("id, name, currency, payment_terms_days")
    .eq("organisation_id", org.id).is("archived_at", null).order("name").limit(2000);
  const list = customers ?? [];
  const selected = list.find((c) => c.id === param(sp.customer));
  const today = todayIn(org.timezone);

  return (
    <>
      <Link href="/invoices" className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-ink"><ChevronLeft className="size-4" />Invoices</Link>
      <PageHeader title="New invoice" description="Record an invoice you have issued so Capflow can track and recover it." />
      {list.length === 0 ? (
        <Card>
          <EmptyState icon={Building2} title="Add a customer first" description="Invoices belong to a customer. Add one, then come back to create the invoice."
            action={<Button asChild><Link href="/customers">Go to customers</Link></Button>} />
        </Card>
      ) : (
        <InvoiceForm
          invoiceId={null}
          customers={list}
          canSend
          defaults={{
            customer_id: selected?.id ?? "", invoice_number: "", issue_date: today,
            due_date: addDays(today, selected?.payment_terms_days ?? 30), currency: selected?.currency ?? org.base_currency,
            notes: "", payment_reference: "", items: [{ description: "", quantity: "1", unit_price: "", tax_rate: "" }],
          }}
        />
      )}
    </>
  );
}
