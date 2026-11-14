"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ORG_COOKIE, requireContext } from "@/lib/auth/context";
import type { ActionResult } from "@/lib/result";

export async function switchOrganisation(organisationId: string): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!ctx.memberships.some((m) => m.organisation_id === organisationId)) {
    return { ok: false, error: "You are not a member of that organisation." };
  }
  (await cookies()).set(ORG_COOKIE, organisationId, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function markNotificationsRead(): Promise<ActionResult> {
  const { supabase, org, user } = await requireContext();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() })
    .eq("organisation_id", org.id).eq("user_id", user.id).is("read_at", null);
  revalidatePath("/", "layout");
  return { ok: true };
}

export interface SearchHit {
  type: "invoice" | "customer";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

export async function globalSearch(query: string): Promise<SearchHit[]> {
  const term = query.trim().replace(/[%_,()]/g, " ").slice(0, 60);
  if (term.length < 2) return [];
  const { supabase, org } = await requireContext();
  const [invoices, customers] = await Promise.all([
    supabase.from("invoice_ledger").select("id, invoice_number, customer_name, effective_status")
      .eq("organisation_id", org.id).is("archived_at", null).ilike("invoice_number", `%${term}%`).limit(6),
    supabase.from("customers").select("id, name, email")
      .eq("organisation_id", org.id).is("archived_at", null).or(`name.ilike.%${term}%,email.ilike.%${term}%`).limit(6),
  ]);
  return [
    ...(customers.data ?? []).map((c): SearchHit => ({
      type: "customer", id: c.id, title: c.name, subtitle: c.email ?? "Customer", href: `/customers/${c.id}`,
    })),
    ...(invoices.data ?? []).map((i): SearchHit => ({
      type: "invoice", id: i.id, title: i.invoice_number, subtitle: `${i.customer_name} · ${String(i.effective_status).replace("_", " ")}`, href: `/invoices/${i.id}`,
    })),
  ];
}
