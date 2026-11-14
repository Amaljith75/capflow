"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/context";
import { guard } from "@/lib/auth/guard";
import { dbErrorMessage, fail, zodFail, type ActionResult } from "@/lib/result";
import { unknownVariables } from "@/lib/templates";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM.");
const ruleSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2, "Enter a name.").max(80),
  approval_mode: z.enum(["manual", "auto"]),
  working_hours_start: time,
  working_hours_end: time,
  max_attempts: z.coerce.number().int().min(1).max(30),
  min_hours_between: z.coerce.number().int().min(1).max(720),
}).refine((v) => v.working_hours_end > v.working_hours_start, { path: ["working_hours_end"], message: "Must be after the start time." });

export async function saveRule(_: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { supabase, org } = await requireRole("finance_manager");
    const parsed = ruleSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return zodFail(parsed.error.issues);
    const days = formData.getAll("working_days").map(Number).filter((d) => d >= 1 && d <= 7);
    if (days.length === 0) return fail("Choose at least one working day.");
    const { id, ...patch } = parsed.data;
    const { error } = await supabase.from("automation_rules").update({
      ...patch, working_days: days, use_ai: formData.get("use_ai") === "on", is_active: formData.get("is_active") === "on",
    }).eq("id", id).eq("organisation_id", org.id);
    if (error) return fail(dbErrorMessage(error));
    revalidatePath("/automations");
    return { ok: true, message: "Automation settings saved." };
  });
}

const stepSchema = z.object({
  id: z.string().uuid().nullable(),
  offset_days: z.number().int().min(-60, "At most 60 days before due.").max(365, "At most 365 days after due."),
  stage: z.string().trim().min(2, "Name the step.").max(80),
  action: z.enum(["send", "escalate"]),
  channel: z.enum(["email", "whatsapp", "sms"]),
  tone: z.enum(["friendly", "professional", "firm", "final"]),
  template_id: z.string().uuid().nullable(),
});
export type StepInput = z.infer<typeof stepSchema>;

/** Saves a sequence. Existing steps keep their ids so reminders already sent for them are never re-sent. */
export async function saveSteps(ruleId: string, steps: StepInput[]): Promise<ActionResult> {
  return guard(async () => {
    const { supabase, org } = await requireRole("finance_manager");
    const parsed = z.array(stepSchema).min(1, "A sequence needs at least one step.").max(20).safeParse(steps);
    if (!parsed.success) return zodFail(parsed.error.issues);
    const offsets = parsed.data.map((s) => s.offset_days);
    if (new Set(offsets).size !== offsets.length) return fail("Two steps cannot fall on the same day.");
    if (parsed.data.some((s) => s.action === "send" && !s.template_id)) return fail("Choose a template for every step that sends a message.");

    const { data: rule } = await supabase.from("automation_rules").select("id").eq("id", ruleId).eq("organisation_id", org.id).maybeSingle();
    if (!rule) return fail("Sequence not found.");
    const { error } = await supabase.rpc("save_rule_steps", {
      p_rule: ruleId,
      p_steps: parsed.data.map((step) => ({ ...step, template_id: step.action === "send" ? step.template_id : null })),
    });
    if (error) return fail(error.code === "23505" ? "Two steps cannot fall on the same day." : dbErrorMessage(error));
    revalidatePath("/automations");
    return { ok: true, message: "Sequence saved. It applies to reminders planned from now on." };
  });
}

const templateSchema = z.object({
  name: z.string().trim().min(2, "Enter a name.").max(80),
  tone: z.enum(["friendly", "professional", "firm", "final"]),
  subject: z.string().trim().min(3, "Enter a subject.").max(200),
  body: z.string().trim().min(20, "The message is too short.").max(5000),
});

export async function saveTemplate(_: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { supabase, org } = await requireRole("finance_manager");
    const parsed = templateSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return zodFail(parsed.error.issues);
    const unknown = unknownVariables(`${parsed.data.subject} ${parsed.data.body}`);
    if (unknown.length) return fail(`Unknown placeholder: {{${unknown[0]}}}. Use only the variables listed below the message.`);
    const id = String(formData.get("id") ?? "");
    const { error } = id
      ? await supabase.from("communication_templates").update(parsed.data).eq("id", id).eq("organisation_id", org.id)
      : await supabase.from("communication_templates").insert({ ...parsed.data, channel: "email", organisation_id: org.id });
    if (error) return fail(dbErrorMessage(error));
    revalidatePath("/communications");
    return { ok: true, message: id ? "Template saved." : "Template created." };
  });
}

export async function deleteTemplate(id: string): Promise<ActionResult> {
  return guard(async () => {
    const { supabase, org } = await requireRole("finance_manager");
    const { count } = await supabase.from("automation_rule_steps").select("id", { count: "exact", head: true }).eq("template_id", id);
    if ((count ?? 0) > 0) return fail("This template is used by a sequence step. Choose another template for that step first.");
    const { error } = await supabase.from("communication_templates").delete().eq("id", id).eq("organisation_id", org.id);
    if (error) return fail(dbErrorMessage(error));
    revalidatePath("/communications");
    return { ok: true, message: "Template deleted." };
  });
}
