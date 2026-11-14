"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/context";
import { guard } from "@/lib/auth/guard";
import { encryptSecret } from "@/lib/crypto";
import { sendEmail } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { dbErrorMessage, fail, zodFail, type ActionResult } from "@/lib/result";

const KINDS = ["email", "whatsapp", "sms", "ai"] as const;
type Kind = (typeof KINDS)[number];

const settingsSchemas: Record<Kind, z.ZodType<Record<string, string>>> = {
  email: z.object({
    from_name: z.string().trim().max(80),
    reply_to: z.union([z.literal(""), z.email("Enter a valid reply-to address.")]),
  }),
  whatsapp: z.object({
    phone_number_id: z.string().trim().regex(/^\d{5,30}$/, "Enter the numeric Phone Number ID from Meta."),
    template_name: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, "Use the approved template name (lowercase, underscores)."),
    template_language: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/, "e.g. en or en_US"),
  }),
  sms: z.object({
    account_sid: z.string().trim().regex(/^AC[0-9a-f]{32}$/, "Enter the Twilio Account SID (starts with AC)."),
    from_number: z.string().trim().regex(/^\+\d{6,15}$/, "Use E.164 format, e.g. +14155550100."),
  }),
  ai: z.object({
    provider: z.enum(["openrouter", "openai", "anthropic", "openai_compatible"]),
    model: z.string().trim().min(2, "Enter a model id.").max(120),
    base_url: z.union([z.literal(""), z.url("Enter a valid URL.").refine((u) => u.startsWith("https://"), "Must use https.")]),
  }),
};

/**
 * Saves non-secret settings (readable by members) and, separately, an encrypted
 * secret that only server processes can read. Secrets are write-only from the UI.
 */
export async function saveIntegration(_: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { supabase, org, user } = await requireRole("admin");
    const kind = String(formData.get("kind")) as Kind;
    if (!KINDS.includes(kind)) return fail("Unknown integration.");
    const raw = Object.fromEntries([...formData.entries()].filter(([k]) => !["kind", "secret", "enabled"].includes(k)).map(([k, v]) => [k, String(v)]));
    const parsed = settingsSchemas[kind].safeParse(raw);
    if (!parsed.success) return zodFail(parsed.error.issues);
    if (kind === "ai" && parsed.data.provider === "openai_compatible" && !parsed.data.base_url) return fail("Enter the base URL for an OpenAI-compatible provider.");

    const secret = String(formData.get("secret") ?? "").trim();
    const enabled = formData.get("enabled") === "on";
    const { data: existing } = await supabase.from("integration_configs").select("has_secret").eq("organisation_id", org.id).eq("kind", kind).maybeSingle();
    const needsSecret = kind !== "email";
    if (enabled && needsSecret && !secret && !existing?.has_secret) return fail("Enter the API key or access token to enable this integration.");

    if (secret) {
      const admin = createAdminClient();
      if (!admin || !process.env.APP_ENCRYPTION_KEY) return fail("The server is missing SUPABASE_SERVICE_ROLE_KEY or APP_ENCRYPTION_KEY, so secrets cannot be stored.");
      if (secret.length > 4000) return fail("That key is too long.");
      const { error } = await admin.from("integration_secrets").upsert({ organisation_id: org.id, kind, ciphertext: encryptSecret(secret), updated_at: new Date().toISOString() });
      if (error) return fail("Could not store the secret.");
    }

    const { error } = await supabase.from("integration_configs").upsert(
      { organisation_id: org.id, kind, enabled, settings: parsed.data, has_secret: Boolean(secret) || Boolean(existing?.has_secret), updated_by: user.id },
      { onConflict: "organisation_id,kind" },
    );
    if (error) return fail(dbErrorMessage(error));
    await supabase.rpc("log_audit", { p_org: org.id, p_action: `integration.${enabled ? "enabled" : "saved"}`, p_entity_type: "integration", p_entity_id: null, p_metadata: { kind, secret_changed: Boolean(secret) } });
    revalidatePath("/integrations");
    return { ok: true, message: "Integration saved." };
  });
}

export async function removeSecret(kind: string): Promise<ActionResult> {
  return guard(async () => {
    const { supabase, org } = await requireRole("admin");
    if (!(KINDS as readonly string[]).includes(kind)) return fail("Unknown integration.");
    const admin = createAdminClient();
    if (!admin) return fail("SUPABASE_SERVICE_ROLE_KEY is not configured.");
    await admin.from("integration_secrets").delete().eq("organisation_id", org.id).eq("kind", kind);
    await supabase.from("integration_configs").update({ has_secret: false, enabled: false }).eq("organisation_id", org.id).eq("kind", kind);
    revalidatePath("/integrations");
    return { ok: true, message: "Credentials removed and integration disabled." };
  });
}

export async function sendTestEmail(): Promise<ActionResult> {
  return guard(async () => {
    const { org, user } = await requireRole("admin");
    const result = await sendEmail({
      to: user.email,
      subject: `Capflow test email for ${org.name}`,
      text: "This is a test message from Capflow. If you received it, reminder emails can be delivered from this workspace.",
    });
    if (result.sent) return { ok: true, message: `Test email sent to ${user.email}.` };
    return fail(result.reason === "not_configured" ? "Email is in sandbox mode: RESEND_API_KEY and EMAIL_FROM are not set on the server." : `The provider rejected the message: ${result.detail}`);
  });
}
