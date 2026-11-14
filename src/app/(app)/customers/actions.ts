"use server";

import { revalidatePath } from "next/cache";
import { PermissionError, requireRole } from "@/lib/auth/context";
import { csvToObjects } from "@/lib/csv";
import { dbErrorMessage, fail, zodFail, type ActionResult } from "@/lib/result";
import { customerSchema } from "@/lib/validation/schemas";

export interface ImportReport {
  imported: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

export async function saveCustomer(_: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, org } = await requireRole("accountant");
    const parsed = customerSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return zodFail(parsed.error.issues);
    const id = formData.get("id");
    const consent = {
      email_opt_out: formData.get("email_opt_out") === "on",
      whatsapp_opt_in: formData.get("whatsapp_opt_in") === "on",
      sms_opt_in: formData.get("sms_opt_in") === "on",
    };

    if (typeof id === "string" && id) {
      const { error } = await supabase.from("customers").update({ ...parsed.data, ...consent }).eq("id", id).eq("organisation_id", org.id);
      if (error) return fail(dbErrorMessage(error));
      revalidatePath("/customers");
      return { ok: true, message: "Customer updated.", data: { id } };
    }
    const { data, error } = await supabase.from("customers").insert({ ...parsed.data, organisation_id: org.id }).select("id").single();
    if (error) return fail(dbErrorMessage(error));
    revalidatePath("/customers");
    return { ok: true, message: "Customer added.", data: { id: data.id } };
  } catch (e) {
    if (e instanceof PermissionError) return fail(e.message);
    throw e;
  }
}

export async function setCustomerArchived(id: string, archived: boolean): Promise<ActionResult> {
  try {
    const { supabase, org } = await requireRole("accountant");
    if (archived) {
      const { count } = await supabase.from("invoice_ledger").select("id", { count: "exact", head: true })
        .eq("customer_id", id).eq("is_open", true);
      if ((count ?? 0) > 0) return fail("This customer still has open invoices. Settle or cancel them before archiving.");
    }
    const { error } = await supabase.from("customers")
      .update({ archived_at: archived ? new Date().toISOString() : null }).eq("id", id).eq("organisation_id", org.id);
    if (error) return fail(dbErrorMessage(error));
    revalidatePath("/customers");
    return { ok: true, message: archived ? "Customer archived." : "Customer restored." };
  } catch (e) {
    if (e instanceof PermissionError) return fail(e.message);
    throw e;
  }
}

/** CSV columns: name (required), email, phone, billing_address, tax_id, currency, payment_terms_days, notes. */
export async function importCustomers(_: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<ImportReport>> {
  try {
    const { supabase, org } = await requireRole("accountant");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return fail("Choose a CSV file.");
    if (file.size > 2_000_000) return fail("The file is larger than 2 MB.");
    const { headers, rows } = csvToObjects(await file.text());
    if (!headers.includes("name")) return fail('The CSV needs a "name" column.');
    if (rows.length > 1000) return fail("Import at most 1,000 customers at a time.");

    const { data: existing } = await supabase.from("customers").select("name").eq("organisation_id", org.id);
    const known = new Set((existing ?? []).map((c) => c.name.trim().toLowerCase()));
    const report: ImportReport = { imported: 0, skipped: 0, errors: [] };
    const toInsert: Record<string, unknown>[] = [];

    rows.forEach((row, index) => {
      const parsed = customerSchema.safeParse({
        name: row.name ?? "", email: row.email ?? "", phone: row.phone ?? "", billing_address: row.billing_address ?? row.address ?? "",
        tax_id: row.tax_id ?? row.gstin ?? row.vat ?? "", currency: (row.currency || org.base_currency).toUpperCase(),
        payment_terms_days: row.payment_terms_days || row.payment_terms || "30", notes: row.notes ?? "",
      });
      if (!parsed.success) {
        report.errors.push({ row: index + 2, message: parsed.error.issues[0]?.message ?? "Invalid row" });
        return;
      }
      const key = parsed.data.name.toLowerCase();
      if (known.has(key)) {
        report.skipped++;
        return;
      }
      known.add(key);
      toInsert.push({ ...parsed.data, organisation_id: org.id });
    });

    for (let i = 0; i < toInsert.length; i += 200) {
      const chunk = toInsert.slice(i, i + 200);
      const { error } = await supabase.from("customers").insert(chunk);
      if (error) return fail(`${dbErrorMessage(error)} ${report.imported} customers were imported before the error.`);
      report.imported += chunk.length;
    }
    revalidatePath("/customers");
    return { ok: true, message: `Imported ${report.imported} customers.`, data: report };
  } catch (e) {
    if (e instanceof PermissionError) return fail(e.message);
    throw e;
  }
}
