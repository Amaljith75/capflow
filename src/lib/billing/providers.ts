import "server-only";
import { env } from "@/lib/env";
import type { Plan } from "@/lib/types";

/**
 * Subscription billing adapters. Capflow never handles card data: both
 * providers use their own hosted checkout. A provider is "configured" only
 * when its API keys are present AND the chosen plan has a provider price id;
 * otherwise checkout is unavailable and the UI says so.
 */

export type BillingProvider = "stripe" | "razorpay";
export type BillingInterval = "monthly" | "annual";

export function providerForCurrency(currency: string): BillingProvider {
  return currency === "INR" ? "razorpay" : "stripe";
}

export function providerStatus(): Record<BillingProvider, boolean> {
  return {
    stripe: env.stripeKey() !== null,
    razorpay: env.razorpayKeyId() !== null && env.razorpayKeySecret() !== null,
  };
}

export class BillingError extends Error {}

interface CheckoutInput {
  plan: Plan;
  interval: BillingInterval;
  organisationId: string;
  organisationName: string;
  email: string;
  existingCustomerId: string | null;
}

async function stripeRequest(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const key = env.stripeKey();
  if (!key) throw new BillingError("Stripe is not configured.");
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    cache: "no-store",
  });
  const json = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const message = (json.error as { message?: string } | undefined)?.message ?? `Stripe error ${response.status}`;
    throw new BillingError(message);
  }
  return json;
}

async function razorpayRequest(path: string, method: "GET" | "POST", body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = env.razorpayKeyId();
  const secret = env.razorpayKeySecret();
  if (!id || !secret) throw new BillingError("Razorpay is not configured.");
  const response = await fetch(`https://api.razorpay.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const message = (json.error as { description?: string } | undefined)?.description ?? `Razorpay error ${response.status}`;
    throw new BillingError(message);
  }
  return json;
}

/** Creates a hosted checkout and returns the URL to redirect the customer to. */
export async function createCheckout(provider: BillingProvider, input: CheckoutInput): Promise<string> {
  const priceId = input.plan.provider_price_ids?.[provider]?.[input.interval];
  if (!priceId) {
    throw new BillingError(
      `The ${input.plan.name} plan has no ${provider} ${input.interval} price configured. Set provider_price_ids on the subscription_plans row.`,
    );
  }
  const metadata = { organisation_id: input.organisationId, plan_id: input.plan.id, interval: input.interval };

  if (provider === "stripe") {
    const params: Record<string, string> = {
      mode: "subscription",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      success_url: `${env.appUrl()}/billing?checkout=success`,
      cancel_url: `${env.appUrl()}/billing?checkout=cancelled`,
      client_reference_id: input.organisationId,
    };
    for (const [k, v] of Object.entries(metadata)) {
      params[`metadata[${k}]`] = v;
      params[`subscription_data[metadata][${k}]`] = v;
    }
    if (input.existingCustomerId) params.customer = input.existingCustomerId;
    else params.customer_email = input.email;
    const session = await stripeRequest("checkout/sessions", params);
    return String(session.url);
  }

  const subscription = await razorpayRequest("subscriptions", "POST", {
    plan_id: priceId,
    total_count: input.interval === "annual" ? 10 : 120,
    customer_notify: 1,
    notes: metadata,
  });
  return String(subscription.short_url);
}

/** Stripe-hosted portal for payment methods, invoices and cancellation. */
export async function createStripePortal(customerId: string): Promise<string> {
  const session = await stripeRequest("billing_portal/sessions", { customer: customerId, return_url: `${env.appUrl()}/billing` });
  return String(session.url);
}

export async function cancelRazorpaySubscription(subscriptionId: string): Promise<void> {
  await razorpayRequest(`subscriptions/${subscriptionId}/cancel`, "POST", { cancel_at_cycle_end: 1 });
}

export async function listRazorpayInvoices(subscriptionId: string): Promise<{ id: string; amount: number; currency: string; status: string; date: number; url: string | null }[]> {
  const result = await razorpayRequest(`invoices?subscription_id=${encodeURIComponent(subscriptionId)}`, "GET");
  const items = (result.items as Record<string, unknown>[] | undefined) ?? [];
  return items.map((i) => ({
    id: String(i.id), amount: Number(i.amount), currency: String(i.currency), status: String(i.status),
    date: Number(i.issued_at ?? i.created_at), url: (i.short_url as string | null) ?? null,
  }));
}
