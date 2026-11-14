"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/context";
import { guard } from "@/lib/auth/guard";
import { can } from "@/lib/permissions";
import { dbErrorMessage, fail, zodFail, type ActionResult } from "@/lib/result";
import { unknownVariables } from "@/lib/templates";

const reminderSchema = z.object({
  invoice_id: z.string().uuid(),
  tone: z.enum(["friendly", "professional", "firm", "final"]),
  subject: z.string().trim().min(3, "Enter a subject.").max(200),
  body: z.string().trim().min(20, "The message is too short.").max(5000),
  token: z.string().min(8).max(64),
});

/** Creates a one-off reminder. Finance managers can queue it for sending; others submit it for approval. */
export async function createManualReminder(_: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { supabase, org, role } = await requireRole("accountant");
    const parsed = reminderSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return zodFail(parsed.error.issues);
    const leftover = unknownVariables(`${parsed.data.subject} ${parsed.data.body}`);
    if (leftover.length > 0 || /\{\{/.test(parsed.data.body)) return fail("The message still contains unfilled {{placeholders}}.");
    const sendNow = formData.get("send_now") === "on" && can(role, "finance_manager");
    const { data: invoice } = await supabase.from("invoices").select("customer_id").eq("id", parsed.data.invoice_id).eq("organisation_id", org.id).maybeSingle();
    if (!invoice) return fail("Invoice not found.");
    const { error } = await supabase.from("reminders").insert({
      organisation_id: org.id, invoice_id: parsed.data.invoice_id, customer_id: invoice.customer_id, stage: "Manual reminder",
      channel: "email", tone: parsed.data.tone, subject: parsed.data.subject, body: parsed.data.body,
      status: sendNow ? "scheduled" : "pending_approval", dedupe_key: `manual:${parsed.data.token}`,
    });
    if (error) return fail(error.code === "23505" ? "That reminder was already submitted." : dbErrorMessage(error));
    revalidatePath(`/invoices/${parsed.data.invoice_id}`);
    return { ok: true, message: sendNow ? "Reminder queued. The worker will send it within a minute." : "Reminder submitted for approval." };
  });
}

export async function decideReminder(id: string, decision: "approve" | "cancel" | "retry"): Promise<ActionResult> {
  return guard(async () => {
    const { supabase, org } = await requireRole("finance_manager");
    const { data, error } = await supabase.from("reminders")
      .update({ status: decision === "cancel" ? "cancelled" : "scheduled" }).eq("id", id).eq("organisation_id", org.id).select("id");
    if (error) return fail(dbErrorMessage(error));
    if (!data?.length) return fail("Reminder not found.");
    revalidatePath("/recovery");
    return { ok: true, message: decision === "approve" ? "Approved. It will be sent within working hours." : decision === "retry" ? "Queued to send again." : "Reminder cancelled." };
  });
}

export async function approveAllReminders(): Promise<ActionResult> {
  return guard(async () => {
    const { supabase, org } = await requireRole("finance_manager");
    const { data, error } = await supabase.from("reminders").update({ status: "scheduled" })
      .eq("organisation_id", org.id).eq("status", "pending_approval").select("id");
    if (error) return fail(dbErrorMessage(error));
    revalidatePath("/recovery");
    return { ok: true, message: `${data?.length ?? 0} reminders approved.` };
  });
}

const editSchema = z.object({
  id: z.string().uuid(),
  subject: z.string().trim().min(3, "Enter a subject.").max(200),
  body: z.string().trim().min(20, "The message is too short.").max(5000),
  tone: z.enum(["friendly", "professional", "firm", "final"]),
});

export async function editReminder(_: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { supabase, org } = await requireRole("finance_manager");
    const parsed = editSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return zodFail(parsed.error.issues);
    const { id, ...patch } = parsed.data;
    const { error } = await supabase.from("reminders").update(patch).eq("id", id).eq("organisation_id", org.id);
    if (error) return fail(dbErrorMessage(error));
    revalidatePath("/recovery");
    return { ok: true, message: "Draft updated." };
  });
}

/** Queues an AI rewrite of a pending reminder. The worker validates the output before saving it. */
export async function requestAiDraft(reminderId: string, tone: string): Promise<ActionResult> {
  return guard(async () => {
    const { supabase, org } = await requireRole("accountant");
    if (!["friendly", "professional", "firm", "final"].includes(tone)) return fail("Unknown tone.");
    const { data: reminder } = await supabase.from("reminders").select("id, status").eq("id", reminderId).eq("organisation_id", org.id).maybeSingle();
    if (!reminder || reminder.status !== "pending_approval") return fail("Only reminders awaiting approval can be rewritten.");
    const { data: integration } = await supabase.from("integration_configs").select("enabled").eq("organisation_id", org.id).eq("kind", "ai").maybeSingle();
    if (!integration?.enabled) return fail("AI drafting is not configured. Enable it under Integrations.");
    const { data: running } = await supabase.from("background_jobs").select("id").eq("organisation_id", org.id)
      .eq("job_type", "ai_draft_reminder").in("status", ["queued", "running"]).contains("payload", { reminder_id: reminderId }).limit(1);
    if (running?.length) return fail("An AI draft is already being generated for this reminder.");
    const { error } = await supabase.from("background_jobs").insert({
      organisation_id: org.id, job_type: "ai_draft_reminder", payload: { reminder_id: reminderId, tone },
    });
    if (error) return fail(dbErrorMessage(error));
    revalidatePath("/recovery");
    return { ok: true, message: "AI draft requested. It usually appears within a minute; refresh to see it." };
  });
}

export async function deEscalate(workflowId: string): Promise<ActionResult> {
  return guard(async () => {
    const { supabase, org } = await requireRole("finance_manager");
    const { data, error } = await supabase.from("recovery_workflows").update({ status: "active", status_reason: null })
      .eq("id", workflowId).eq("organisation_id", org.id).select("invoice_id");
    if (error) return fail(dbErrorMessage(error));
    if (!data?.length) return fail("This invoice is not escalated.");
    await supabase.rpc("log_audit", { p_org: org.id, p_action: "recovery.deescalated", p_entity_type: "invoice", p_entity_id: data[0].invoice_id, p_metadata: {} });
    revalidatePath("/recovery");
    return { ok: true, message: "Escalation cleared." };
  });
}
