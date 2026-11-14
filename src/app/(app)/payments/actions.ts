"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/context";
import { guard } from "@/lib/auth/guard";
import { cleanAmount, csvToObjects } from "@/lib/csv";
import { parseFlexibleDate } from "@/lib/dates";
import { fromMinor, toMinor } from "@/lib/money";
import { dbErrorMessage, fail, zodFail, type ActionResult } from "@/lib/result";
import { paymentSchema, type PaymentInput } from "@/lib/validation/schemas";
import type { ImportReport } from "../customers/actions";

export interface OpenInvoice {
  id: string;
  invoice_number: string;
  due_date: string;
  currency: string;
  amount_outstanding: number;
  days_overdue: number;
}

export async function loadOpenInvoices(customerId: string): Promise<OpenInvoice[]> {
  const { supabase, org } = await requireRole("viewer");
  const { data } = await supabase.from("invoice_ledger")
    .select("id, invoice_number, due_date, currency, amount_outstanding, days_overdue")
    .eq("organisation_id", org.id).eq("customer_id", customerId).is("archived_at", null)
    .in("status", ["sent", "partially_paid", "disputed"]).order("due_date").limit(100);
  return (data ?? []) as OpenInvoice[];
}

export interface DuplicateWarning {
  id: string;
  amount: number;
  currency: string;
  payment_date: string;
  reference: string | null;
}

export async function recordPayment(input: PaymentInput): Promise<ActionResult<{ id?: string; duplicates?: DuplicateWarning[] }>> {
  return guard<{ id?: string; duplicates?: DuplicateWarning[] }>(async () => {
    const { supabase, org } = await requireRole("accountant");
    const parsed = paymentSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error.issues);
    const p = parsed.data;

    const allocated = p.allocations.reduce((sum, a) => sum + toMinor(a.amount), 0n);
    if (allocated > toMinor(p.amount)) return fail("The amounts applied to invoices add up to more than the payment.");
    if (new Set(p.allocations.map((a) => a.invoice_id)).size !== p.allocations.length) return fail("An invoice appears twice in the allocation.");

    if (!p.confirm_duplicate) {
      const { data: duplicates } = await supabase.rpc("find_duplicate_payments", {
        p_org: org.id, p_customer: p.customer_id, p_amount: p.amount, p_payment_date: p.payment_date, p_reference: p.reference,
      });
      if (duplicates && duplicates.length > 0) {
        return { ok: true, data: { duplicates: (duplicates as DuplicateWarning[]).map((d) => ({ id: d.id, amount: d.amount, currency: d.currency, payment_date: d.payment_date, reference: d.reference })) } };
      }
    }

    const { data, error } = await supabase.rpc("record_payment", {
      p_org: org.id, p_customer: p.customer_id, p_amount: p.amount, p_currency: p.currency, p_payment_date: p.payment_date,
      p_method: p.method, p_reference: p.reference, p_notes: p.notes, p_allocations: p.allocations, p_idempotency_key: p.idempotency_key,
    });
    if (error) return fail(dbErrorMessage(error));
    revalidatePath("/payments");
    const unallocated = toMinor(p.amount) - allocated;
    return {
      ok: true,
      message: unallocated > 0n ? `Payment recorded. ${fromMinor(unallocated)} ${p.currency} is unallocated and not applied to any invoice.` : "Payment recorded and invoices updated.",
      data: { id: String(data) },
    };
  });
}

export async function voidPayment(_: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { supabase, org } = await requireRole("finance_manager");
    const id = String(formData.get("id") ?? "");
    const reason = String(formData.get("reason") ?? "").trim();
    if (reason.length < 3) return fail("Give a reason for voiding this payment.", { reason: ["Give a reason."] });
    const { data, error } = await supabase.from("payments")
      .update({ voided_at: new Date().toISOString(), void_reason: reason.slice(0, 500) }).eq("id", id).eq("organisation_id", org.id).select("id");
    if (error) return fail(dbErrorMessage(error));
    if (!data?.length) return fail("Payment not found.");
    revalidatePath("/payments");
    return { ok: true, message: "Payment voided. Invoice balances were recalculated." };
  });
}

/**
 * CSV columns: invoice_number*, amount*, payment_date*, reference, method, notes.
 * Each row gets a deterministic idempotency key, so importing the same file twice records nothing new.
 */
export async function importPayments(_: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<ImportReport>> {
  return guard<ImportReport>(async () => {
    const { supabase, org } = await requireRole("accountant");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return fail("Choose a CSV file.");
    if (file.size > 2_000_000) return fail("The file is larger than 2 MB.");
    const { headers, rows } = csvToObjects(await file.text());
    for (const required of ["invoice_number", "amount", "payment_date"]) {
      if (!headers.includes(required)) return fail(`The CSV needs a "${required}" column.`);
    }
    if (rows.length > 500) return fail("Import at most 500 payments at a time.");

    const { data: invoices } = await supabase.from("invoices").select("id, invoice_number, customer_id, currency").eq("organisation_id", org.id);
    const byNumber = new Map((invoices ?? []).map((i) => [i.invoice_number.trim().toLowerCase(), i]));
    const { data: existingKeys } = await supabase.from("payments").select("idempotency_key").eq("organisation_id", org.id).eq("source", "csv_import");
    const seen = new Set((existingKeys ?? []).map((k) => k.idempotency_key));
    const report: ImportReport = { imported: 0, skipped: 0, errors: [] };
    const methods = ["bank_transfer", "upi", "card", "cash", "cheque", "other"];

    for (const [index, row] of rows.entries()) {
      const reject = (message: string) => report.errors.push({ row: index + 2, message });
      const invoice = byNumber.get((row.invoice_number ?? "").trim().toLowerCase());
      if (!invoice) { reject(`Invoice "${row.invoice_number}" not found.`); continue; }
      const amount = cleanAmount(row.amount ?? "");
      if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) { reject("Invalid amount."); continue; }
      const date = parseFlexibleDate(row.payment_date ?? "");
      if (!date) { reject("Invalid payment date. Use YYYY-MM-DD or DD/MM/YYYY."); continue; }
      const method = (row.method ?? "").toLowerCase().replace(/\s+/g, "_");
      const key = `csv:${createHash("sha256").update([invoice.id, amount, date, row.reference ?? ""].join("|")).digest("hex").slice(0, 40)}`;
      if (seen.has(key)) { report.skipped++; continue; }

      const { error } = await supabase.rpc("record_payment", {
        p_org: org.id, p_customer: invoice.customer_id, p_amount: amount, p_currency: invoice.currency, p_payment_date: date,
        p_method: methods.includes(method) ? method : "bank_transfer", p_reference: row.reference ?? "", p_notes: row.notes ?? "",
        p_allocations: [{ invoice_id: invoice.id, amount }], p_idempotency_key: key, p_source: "csv_import",
      });
      if (error) { reject(dbErrorMessage(error)); continue; }
      seen.add(key);
      report.imported++;
    }
    revalidatePath("/payments");
    return { ok: true, message: `Imported ${report.imported} payments.`, data: report };
  });
}
