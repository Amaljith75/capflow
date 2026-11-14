import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { can, type Role } from "@/lib/permissions";
import type { Entitlements, Membership, Organisation } from "@/lib/types";

export const ORG_COOKIE = "cf_org";

export const getSession = cache(async () => {
  if (!isSupabaseConfigured()) redirect("/setup");
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
});

export interface AppContext {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: { id: string; email: string; fullName: string | null };
  memberships: Membership[];
  org: Organisation;
  role: Role;
}

/**
 * Resolves the signed-in user and their active organisation, or redirects.
 * The active organisation comes from a cookie but is always re-validated
 * against the user's memberships, and RLS independently enforces access.
 */
export const requireContext = cache(async (): Promise<AppContext> => {
  const { supabase, user } = await getSession();
  if (!user) redirect("/login");

  const [{ data: memberships }, { data: profile }] = await Promise.all([
    supabase
      .from("organisation_members")
      .select("id, organisation_id, role, organisations(id, name, slug, legal_name, tax_id, billing_email, address, country, base_currency, timezone)")
      .eq("user_id", user.id)
      .order("created_at"),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);

  const list = ((memberships ?? []) as unknown as Membership[]).filter((m) => m.organisations);
  if (list.length === 0) redirect("/onboarding");

  const preferred = (await cookies()).get(ORG_COOKIE)?.value;
  const active = list.find((m) => m.organisation_id === preferred) ?? list[0];

  return {
    supabase,
    user: { id: user.id, email: user.email ?? "", fullName: (profile?.full_name as string | null) ?? null },
    memberships: list,
    org: active.organisations,
    role: active.role,
  };
});

export const getEntitlements = cache(async (): Promise<Entitlements> => {
  const { supabase, org } = await requireContext();
  const { data } = await supabase.rpc("org_entitlements", { p_org: org.id });
  return (data ?? {
    plan_id: null, status: "none", active: false, trial_ends_at: null, current_period_end: null,
    cancel_at_period_end: false, billing_interval: null, provider: null, limits: {},
    usage: { users: 0, invoices_this_month: 0, reminders_this_month: 0, automation_rules: 0 },
  }) as Entitlements;
});

export class PermissionError extends Error {}

/** For server actions: returns the context or throws when the role is insufficient. */
export async function requireRole(minimum: Role): Promise<AppContext> {
  const ctx = await requireContext();
  if (!can(ctx.role, minimum)) throw new PermissionError("You don't have permission to do that.");
  return ctx;
}
