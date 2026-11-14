"use server";

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/context";
import { BillingError, cancelRazorpaySubscription, createCheckout, createStripePortal, providerForCurrency, providerStatus, type BillingInterval } from "@/lib/billing/providers";
import { fail, type ActionResult } from "@/lib/result";
import { guard } from "@/lib/auth/guard";
import type { Plan } from "@/lib/types";

export async function startCheckout(planId: string, interval: BillingInterval): Promise<ActionResult> {
  let url: string | null = null;
  const result = await guard(async () => {
    const { supabase, org, user } = await requireRole("owner");
    if (!["monthly", "annual"].includes(interval)) return fail("Choose monthly or annual billing.");
    const { data: plan } = await supabase.from("subscription_plans").select("*").eq("id", planId).maybeSingle();
    if (!plan || !plan.prices) return fail("This plan is not available for self-service checkout. Contact sales.");
    const provider = providerForCurrency(org.base_currency === "INR" ? "INR" : "USD");
    if (!providerStatus()[provider]) return fail(`${provider === "stripe" ? "Stripe" : "Razorpay"} is not configured on this server, so online checkout is unavailable.`);
    const { data: sub } = await supabase.from("subscriptions").select("provider, provider_customer_id").eq("organisation_id", org.id).maybeSingle();
    try {
      url = await createCheckout(provider, {
        plan: plan as Plan, interval, organisationId: org.id, organisationName: org.name, email: org.billing_email ?? user.email,
        existingCustomerId: sub?.provider === provider ? sub.provider_customer_id : null,
      });
    } catch (e) {
      if (e instanceof BillingError) return fail(e.message);
      throw e;
    }
    return { ok: true };
  });
  if (result.ok && url) redirect(url);
  return result;
}

export async function openBillingPortal(): Promise<ActionResult> {
  let url: string | null = null;
  const result = await guard(async () => {
    const { supabase, org } = await requireRole("owner");
    const { data: sub } = await supabase.from("subscriptions").select("provider, provider_customer_id").eq("organisation_id", org.id).maybeSingle();
    if (sub?.provider !== "stripe" || !sub.provider_customer_id) return fail("There is no Stripe billing account for this organisation.");
    try {
      url = await createStripePortal(sub.provider_customer_id);
    } catch (e) {
      if (e instanceof BillingError) return fail(e.message);
      throw e;
    }
    return { ok: true };
  });
  if (result.ok && url) redirect(url);
  return result;
}

export async function cancelSubscription(): Promise<ActionResult> {
  return guard(async () => {
    const { supabase, org } = await requireRole("owner");
    const { data: sub } = await supabase.from("subscriptions").select("provider, provider_subscription_id").eq("organisation_id", org.id).maybeSingle();
    if (sub?.provider !== "razorpay" || !sub.provider_subscription_id) return fail("Manage this subscription from the billing portal.");
    try {
      await cancelRazorpaySubscription(sub.provider_subscription_id);
    } catch (e) {
      if (e instanceof BillingError) return fail(e.message);
      throw e;
    }
    // The status change itself arrives through the verified webhook.
    return { ok: true, message: "Cancellation requested. Your plan stays active until the end of the current period." };
  });
}
