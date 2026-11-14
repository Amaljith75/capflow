"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext, requireRole } from "@/lib/auth/context";
import { guard } from "@/lib/auth/guard";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { ROLE_LABELS, ROLES, type Role } from "@/lib/permissions";
import { dbErrorMessage, fail, zodFail, type ActionResult } from "@/lib/result";

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
  role: z.enum(["viewer", "accountant", "finance_manager", "admin"]),
});

export async function inviteMember(_: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<{ link: string; emailed: boolean }>> {
  return guard<{ link: string; emailed: boolean }>(async () => {
    const { supabase, org, user } = await requireRole("admin");
    const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return zodFail(parsed.error.issues);
    const { data: token, error } = await supabase.rpc("create_invitation", { p_org: org.id, p_email: parsed.data.email, p_role: parsed.data.role });
    if (error) return fail(dbErrorMessage(error));
    const link = `${env.appUrl()}/invite/${token}`;
    const result = await sendEmail({
      to: parsed.data.email,
      subject: `You've been invited to ${org.name} on Capflow`,
      text: `${user.fullName ?? user.email} invited you to join ${org.name} on Capflow as ${ROLE_LABELS[parsed.data.role]}.\n\nAccept the invitation:\n${link}\n\nThis link expires in 7 days. If you weren't expecting it, you can ignore this email.`,
    });
    revalidatePath("/team");
    return {
      ok: true,
      message: result.sent ? `Invitation emailed to ${parsed.data.email}.` : "Invitation created. Email is not configured, so share the link yourself.",
      data: { link, emailed: result.sent },
    };
  });
}

export async function revokeInvitation(id: string): Promise<ActionResult> {
  return guard(async () => {
    const { supabase } = await requireRole("admin");
    const { error } = await supabase.rpc("revoke_invitation", { p_invitation: id });
    if (error) return fail(dbErrorMessage(error));
    revalidatePath("/team");
    return { ok: true, message: "Invitation revoked." };
  });
}

export async function changeRole(memberId: string, role: string): Promise<ActionResult> {
  return guard(async () => {
    const { supabase } = await requireRole("admin");
    if (!(ROLES as readonly string[]).includes(role)) return fail("Unknown role.");
    const { error } = await supabase.rpc("update_member_role", { p_member: memberId, p_role: role as Role });
    if (error) return fail(dbErrorMessage(error));
    revalidatePath("/team");
    return { ok: true, message: "Role updated." };
  });
}

export async function removeMember(memberId: string): Promise<ActionResult> {
  return guard(async () => {
    const { supabase } = await requireContext();
    const { error } = await supabase.rpc("remove_member", { p_member: memberId });
    if (error) return fail(dbErrorMessage(error));
    revalidatePath("/team");
    return { ok: true, message: "Member removed." };
  });
}
