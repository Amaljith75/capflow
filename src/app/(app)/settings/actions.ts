"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ORG_COOKIE, requireContext, requireRole } from "@/lib/auth/context";
import { guard } from "@/lib/auth/guard";
import { dbErrorMessage, fail, zodFail, type ActionResult } from "@/lib/result";

const orgSchema = z.object({
  name: z.string().trim().min(2, "Enter a name.").max(120),
  legal_name: z.string().trim().max(200),
  tax_id: z.string().trim().max(50),
  billing_email: z.union([z.literal(""), z.email("Enter a valid email.")]),
  address: z.string().trim().max(500),
  timezone: z.string().min(1),
});

export async function saveOrganisation(_: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { supabase, org } = await requireRole("admin");
    const parsed = orgSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return zodFail(parsed.error.issues);
    if (!Intl.supportedValuesOf("timeZone").includes(parsed.data.timezone) && parsed.data.timezone !== "UTC") return fail("Unknown time zone.");
    const blank = (v: string) => (v === "" ? null : v);
    const { error } = await supabase.from("organisations").update({
      name: parsed.data.name, legal_name: blank(parsed.data.legal_name), tax_id: blank(parsed.data.tax_id),
      billing_email: blank(parsed.data.billing_email), address: blank(parsed.data.address), timezone: parsed.data.timezone,
    }).eq("id", org.id);
    if (error) return fail(dbErrorMessage(error));
    revalidatePath("/", "layout");
    return { ok: true, message: "Organisation updated." };
  });
}

export async function saveProfile(_: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { supabase, user } = await requireContext();
    const parsed = z.object({ full_name: z.string().trim().min(2, "Enter your name.").max(100) }).safeParse(Object.fromEntries(formData));
    if (!parsed.success) return zodFail(parsed.error.issues);
    const { error } = await supabase.from("profiles").update({ full_name: parsed.data.full_name }).eq("id", user.id);
    if (error) return fail(dbErrorMessage(error));
    revalidatePath("/", "layout");
    return { ok: true, message: "Profile updated." };
  });
}

export async function deleteOrganisation(_: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult> {
  const result = await guard(async () => {
    const { supabase, org } = await requireRole("owner");
    if (String(formData.get("confirm") ?? "").trim() !== org.name) return fail("Type the organisation name exactly to confirm.", { confirm: ["Does not match."] });
    const { error } = await supabase.rpc("delete_organisation", { p_org: org.id });
    if (error) return fail(dbErrorMessage(error));
    (await cookies()).delete(ORG_COOKIE);
    return { ok: true };
  });
  if (result.ok) redirect("/dashboard");
  return result;
}
