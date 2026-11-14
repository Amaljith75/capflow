"use server";

import { revalidatePath } from "next/cache";
import { getEntitlements, requireRole } from "@/lib/auth/context";
import { guard } from "@/lib/auth/guard";
import { cleanAmount, csvToObjects } from "@/lib/csv";
import { addDays, parseFlexibleDate } from "@/lib/dates";
import { dbErrorMessage, fail, zodFail, type ActionResult } from "@/lib/result";
import { invoiceSchema, promiseSchema, type InvoiceInput } from "@/lib/validation/schemas";
import type { ImportReport } from "../customers/actions";

export async function saveInvoice(invoiceId: string | null, input: InvoiceInput, send: boolean): Promise<ActionResult<{ id: string }>> {
  return guard<{ id: string }>(async () => {
    const { supabase, org } = await requireRole("accountant");
    const parsed = invoiceSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error.issues);
    const { items, ...header } = parsed.data;
    const { data, error } = await supabase.rpc("save_invoice", {
      p_org: org.id,
      p_invoice: invoiceId,
      p_data: header,
      p_items: items.map((i) => ({ description: i.description, quantity: i.quantity, unit_price: i.unit_price, tax_rate: i.tax_rate === "" ? null : i.tax_rate, tax_amount: i.tax_rate === "" && i.tax_amount ? i.tax_amount : "0" })),
      p_send: send,
    });
    if (error) return fail(dbErrorMessage(error));
    revalidatePath("/invoices");
    return { ok: true, message: invoiceId ? "Invoice updated." : send ? "Invoice created and marked as sent." : "Draft saved.", data: { id: String(data) } };
  });
}

type Transition = "send" | "cancel" | "dispute" | "resolve_dispute" | "archive" | "restore" | "pause" | "resume" | "delete";

export async function transitionInvoice(id: string, transition: Transition, reason?: string): Promise<ActionResult> {
  return guard(async () => {
    const { supabase, org } = await requireRole("accountant");
    const patch: Record<Transition, Record<string, unknown> | null> = {
      send: { status: "sent" },
      cancel: { status: "cancelled" },
      dispute: { status: "disputed", dispute_reason: (reason ?? "").trim().slice(0, 500) || null },
      resolve_dispute: { status: "sent" },
      archive: { archived_at: new Date().toISOString() },
      restore: { archived_at: null },
      pause: { recovery_paused: true },
      resume: { recovery_paused: false },
      delete: null,
    };
    if (transition === "dispute" && !patch.dispute?.dispute_reason) return fail("Describe what the customer is disputing.");

    const change = patch[transition];
    const query = change
      ? supabase.from("invoices").update(change).eq("id", id).eq("organisation_id", org.id).select("id")
      : supabase.from("invoices").delete().eq("id", id).eq("organisation_id", org.id).select("id");
    const { data, error } = await query;
    if (error) return fail(dbErrorMessage(error));
    if (!data || data.length === 0) {
      return fail(transition === "delete" ? "Only drafts that were never sent can be deleted. Archive or cancel this invoice instead." : "Invoice not found.");
    }
    revalidatePath("/invoices");
    const messages: Record<Transition, string> = {
      send: "Invoice marked as sent. Recovery automation is now active.", cancel: "Invoice cancelled.",
      dispute: "Invoice marked as disputed. Automated reminders are stopped.", resolve_dispute: "Dispute resolved. Recovery resumes.",
      archive: "Invoice archived.", restore: "Invoice restored.", pause: "Recovery paused for this invoice.",
      resume: "Recovery resumed.", delete: "Draft deleted.",
    };
    return { ok: true, message: messages[transition] };
  });
}

export async function bulkInvoiceAction(ids: string[], action: "send" | "archive" | "pause" | "resume"): Promise<ActionResult> {
  return guard(async () => {
    const { supabase, org } = await requireRole("accountant");
    const entitlements = await getEntitlements();
    if (!entitlements.limits.bulk_operations) return fail("Bulk operations are part of the Business plan.");
    const unique = [...new Set(ids)].slice(0, 200);
    if (unique.length === 0) return fail("Select at least one invoice.");
    let done = 0;
    const failures: string[] = [];
    for (const id of unique) {
      const change = action === "send" ? { status: "sent" } : action === "archive" ? { archived_at: new Date().toISOString() } : { recovery_paused: action === "pause" };
      let q = supabase.from("invoices").update(change).eq("id", id).eq("organisation_id", org.id);
      if (action === "send") q = q.eq("status", "draft");
      const { data, error } = await q.select("invoice_number");
      if (error) failures.push(dbErrorMessage(error));
      else if (data && data.length > 0) done++;
    }
    revalidatePath("/invoices");
    if (done === 0) return fail(failures[0] ?? "None of the selected invoices could be updated.");
    return { ok: true, message: `${done} of ${unique.length} invoices updated${failures.length ? `; ${failures.length} failed` : ""}.` };
  });
}

const ALLOWED_TYPES: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" };

/** Checks the leading bytes so a renamed file cannot masquerade as a PDF or image. */
function matchesSignature(bytes: Uint8Array, type: string): boolean {
  const starts = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (type === "application/pdf") return starts([0x25, 0x50, 0x44, 0x46]);
  if (type === "image/png") return starts([0x89, 0x50, 0x4e, 0x47]);
  return starts([0xff, 0xd8, 0xff]);
}

export async function uploadAttachment(_: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { supabase, org } = await requireRole("accountant");
    const invoiceId = String(formData.get("invoice_id") ?? "");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return fail("Choose a file to upload.");
    if (file.size > 10 * 1024 * 1024) return fail("Attachments can be at most 10 MB.");
    const ext = ALLOWED_TYPES[file.type];
    if (!ext) return fail("Only PDF, PNG and JPEG files are allowed.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!matchesSignature(bytes, file.type)) return fail("The file content does not match its type.");

    const { data: invoice } = await supabase.from("invoices").select("id, attachment_path").eq("id", invoiceId).eq("organisation_id", org.id).maybeSingle();
    if (!invoice) return fail("Invoice not found.");
    const path = `${org.id}/${invoice.id}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from("invoice-files").upload(path, bytes, { contentType: file.type, upsert: false });
    if (uploadError) return fail("The upload failed. Check that the storage bucket exists and try again.");
    const { error } = await supabase.from("invoices")
      .update({ attachment_path: path, attachment_name: file.name.replace(/[^\w. -]/g, "_").slice(0, 120) }).eq("id", invoice.id);
    if (error) {
      await supabase.storage.from("invoice-files").remove([path]);
      return fail(dbErrorMessage(error));
    }
    if (invoice.attachment_path) await supabase.storage.from("invoice-files").remove([invoice.attachment_path]);
    revalidatePath(`/invoices/${invoice.id}`);
    return { ok: true, message: "Attachment uploaded." };
  });
}

export async function attachmentUrl(invoiceId: string): Promise<ActionResult<{ url: string }>> {
  return guard<{ url: string }>(async () => {
    const { supabase, org } = await requireRole("viewer");
    const { data: invoice } = await supabase.from("invoices").select("attachment_path").eq("id", invoiceId).eq("organisation_id", org.id).maybeSingle();
    if (!invoice?.attachment_path) return fail("This invoice has no attachment.");
    const { data, error } = await supabase.storage.from("invoice-files").createSignedUrl(invoice.attachment_path, 60);
    if (error || !data) return fail("Could not open the attachment.");
    return { ok: true, data: { url: data.signedUrl } };
  });
}

export async function createPromise(_: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { supabase, org } = await requireRole("accountant");
    const parsed = promiseSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return zodFail(parsed.error.issues);
    const { data: invoice } = await supabase.from("invoices").select("customer_id").eq("id", parsed.data.invoice_id).eq("organisation_id", org.id).maybeSingle();
    if (!invoice) return fail("Invoice not found.");
    const { error } = await supabase.from("payment_promises").insert({
      organisation_id: org.id, invoice_id: parsed.data.invoice_id, customer_id: invoice.customer_id,
      promised_amount: parsed.data.promised_amount, promised_date: parsed.data.promised_date, notes: parsed.data.notes ?? null,
    });
    if (error) {
      return fail(error.code === "23505" ? "This invoice already has a pending promise. Cancel it before recording a new one." : dbErrorMessage(error));
    }
    revalidatePath(`/invoices/${parsed.data.invoice_id}`);
    return { ok: true, message: "Payment promise recorded. Reminders are on hold until the promised date." };
  });
}

export async function cancelPromise(id: string): Promise<ActionResult> {
  return guard(async () => {
    const { supabase, org } = await requireRole("accountant");
    const { error } = await supabase.from("payment_promises").update({ status: "cancelled" }).eq("id", id).eq("organisation_id", org.id);
    if (error) return fail(dbErrorMessage(error));
    revalidatePath("/recovery");
    return { ok: true, message: "Promise cancelled. Recovery resumes." };
  });
}

export async function clearFollowUp(id: string): Promise<ActionResult> {
  return guard(async () => {
    const { supabase, org } = await requireRole("accountant");
    const { error } = await supabase.from("payment_promises").update({ follow_up_date: null }).eq("id", id).eq("organisation_id", org.id);
    if (error) return fail(dbErrorMessage(error));
    revalidatePath("/recovery");
    return { ok: true, message: "Follow-up marked as done." };
  });
}

/**
 * CSV columns: invoice_number*, customer*, due_date*, amount* (pre-tax), issue_date, tax (amount),
 * currency, customer_email, notes, status (draft|sent). Unknown customers are created.
 * Invoices whose number already exists are skipped, so re-importing is safe.
 */
export async function importInvoices(_: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<ImportReport>> {
  return guard<ImportReport>(async () => {
    const { supabase, org } = await requireRole("accountant");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return fail("Choose a CSV file.");
    if (file.size > 2_000_000) return fail("The file is larger than 2 MB.");
    const { headers, rows } = csvToObjects(await file.text());
    for (const required of ["invoice_number", "customer", "due_date", "amount"]) {
      if (!headers.includes(required)) return fail(`The CSV needs a "${required}" column.`);
    }
    if (rows.length > 500) return fail("Import at most 500 invoices at a time.");

    const [{ data: customers }, { data: existing }] = await Promise.all([
      supabase.from("customers").select("id, name, currency, payment_terms_days").eq("organisation_id", org.id),
      supabase.from("invoices").select("invoice_number").eq("organisation_id", org.id),
    ]);
    const byName = new Map((customers ?? []).map((c) => [c.name.trim().toLowerCase(), c]));
    const numbers = new Set((existing ?? []).map((i) => i.invoice_number.trim().toLowerCase()));
    const report: ImportReport = { imported: 0, skipped: 0, errors: [] };

    for (const [index, row] of rows.entries()) {
      const line = index + 2;
      const reject = (message: string) => report.errors.push({ row: line, message });
      const number = (row.invoice_number ?? "").trim();
      if (!number) { reject("Missing invoice number."); continue; }
      if (numbers.has(number.toLowerCase())) { report.skipped++; continue; }
      const due = parseFlexibleDate(row.due_date ?? "");
      if (!due) { reject("Invalid due date. Use YYYY-MM-DD or DD/MM/YYYY."); continue; }
      const amountText = cleanAmount(row.amount ?? "");
      const taxText = cleanAmount(row.tax ?? "") || "0";
      if (!/^\d+(\.\d{1,2})?$/.test(amountText) || Number(amountText) <= 0) { reject("Invalid amount."); continue; }
      if (!/^\d+(\.\d{1,2})?$/.test(taxText)) { reject("Invalid tax amount."); continue; }
      const customerName = (row.customer ?? "").trim();
      if (!customerName) { reject("Missing customer."); continue; }

      let customer = byName.get(customerName.toLowerCase());
      if (!customer) {
        const currency = (row.currency || org.base_currency).toUpperCase();
        const { data: created, error } = await supabase.from("customers")
          .insert({ organisation_id: org.id, name: customerName, email: row.customer_email?.toLowerCase() || null, currency })
          .select("id, name, currency, payment_terms_days").single();
        if (error || !created) { reject(`Could not create customer: ${dbErrorMessage(error)}`); continue; }
        customer = created;
        byName.set(customerName.toLowerCase(), created);
      }
      const issue = row.issue_date ? parseFlexibleDate(row.issue_date) : addDays(due, -customer.payment_terms_days);
      if (!issue || issue > due) { reject("Invalid issue date (it must not be after the due date)."); continue; }

      const { error } = await supabase.rpc("save_invoice", {
        p_org: org.id, p_invoice: null,
        p_data: { customer_id: customer.id, invoice_number: number, issue_date: issue, due_date: due, currency: (row.currency || customer.currency).toUpperCase(), notes: row.notes ?? "", payment_reference: "" },
        p_items: [{ description: row.description || "Imported invoice", quantity: "1", unit_price: amountText, tax_rate: null, tax_amount: taxText }],
        p_send: (row.status ?? "sent").toLowerCase() !== "draft",
      });
      if (error) { reject(dbErrorMessage(error)); if (error.message.includes("plan_limit") || error.message.includes("subscription_inactive")) break; continue; }
      numbers.add(number.toLowerCase());
      report.imported++;
    }
    revalidatePath("/invoices");
    return { ok: true, message: `Imported ${report.imported} invoices.`, data: report };
  });
}

