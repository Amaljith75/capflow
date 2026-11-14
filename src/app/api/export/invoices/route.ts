import { NextResponse } from "next/server";
import { requireContext } from "@/lib/auth/context";
import { toCsv } from "@/lib/csv";

export async function GET() {
  const { supabase, org } = await requireContext();
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("invoice_ledger")
      .select("invoice_number, customer_name, customer_email, issue_date, due_date, currency, subtotal, tax_total, total, amount_paid, amount_outstanding, effective_status, days_overdue, paid_on, payment_reference, notes, archived_at")
      .eq("organisation_id", org.id).order("issue_date").range(from, from + 999);
    if (error) return NextResponse.json({ error: "export failed" }, { status: 500 });
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const headers = ["invoice_number", "customer_name", "customer_email", "issue_date", "due_date", "currency", "subtotal", "tax_total", "total", "amount_paid", "amount_outstanding", "effective_status", "days_overdue", "paid_on", "payment_reference", "notes", "archived_at"];
  return new NextResponse(toCsv(headers, rows.map((r) => headers.map((h) => r[h]))), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="capflow-invoices-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" },
  });
}
