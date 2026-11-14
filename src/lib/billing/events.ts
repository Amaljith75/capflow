/**
 * Pure translation of provider webhook payloads into a subscription update.
 * Kept free of I/O so it can be unit tested.
 */
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "cancelled" | "expired";

export interface SubscriptionUpdate {
  organisationId: string;
  planId: string | null;
  status: SubscriptionStatus;
  interval: "monthly" | "annual" | null;
  provider: "stripe" | "razorpay";
  customerId: string | null;
  subscriptionId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean | null;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const iso = (seconds: unknown): string | null => (typeof seconds === "number" && seconds > 0 ? new Date(seconds * 1000).toISOString() : null);
const interval = (v: unknown): "monthly" | "annual" | null => (v === "monthly" || v === "annual" ? v : null);

export function mapStripeStatus(status: string): SubscriptionStatus {
  switch (status) {
    case "active": return "active";
    case "trialing": return "trialing";
    case "past_due":
    case "unpaid": return "past_due";
    case "canceled": return "cancelled";
    case "incomplete_expired": return "expired";
    default: return "past_due"; // incomplete, paused: access depends on payment
  }
}

export function mapRazorpayStatus(event: string, status: string): SubscriptionStatus | null {
  if (event === "subscription.cancelled" || status === "cancelled") return "cancelled";
  if (event === "subscription.completed" || status === "completed" || status === "expired") return "expired";
  if (event === "subscription.halted" || event === "subscription.pending" || status === "halted" || status === "pending") return "past_due";
  if (event === "subscription.activated" || event === "subscription.charged" || event === "subscription.resumed" || status === "active") return "active";
  return null;
}

/** Stripe event → update, or null when the event is not one we act on. */
export function stripeEventToUpdate(event: Json): SubscriptionUpdate | null {
  const type = str(event.type);
  const object = obj(obj(event.data).object);
  if (type === "checkout.session.completed") {
    const meta = obj(object.metadata);
    const org = str(meta.organisation_id) ?? str(object.client_reference_id);
    if (!org || object.mode !== "subscription") return null;
    return {
      organisationId: org, planId: str(meta.plan_id), status: "active", interval: interval(meta.interval), provider: "stripe",
      customerId: str(object.customer), subscriptionId: str(object.subscription), periodStart: null, periodEnd: null, cancelAtPeriodEnd: false,
    };
  }
  if (type === "customer.subscription.updated" || type === "customer.subscription.deleted" || type === "customer.subscription.created") {
    const meta = obj(object.metadata);
    const org = str(meta.organisation_id);
    if (!org) return null;
    const item = obj((obj(object.items).data as unknown[] | undefined)?.[0]);
    return {
      organisationId: org, planId: str(meta.plan_id), interval: interval(meta.interval), provider: "stripe",
      status: type === "customer.subscription.deleted" ? "cancelled" : mapStripeStatus(String(object.status)),
      customerId: str(object.customer), subscriptionId: str(object.id),
      periodStart: iso(object.current_period_start ?? item.current_period_start),
      periodEnd: iso(object.current_period_end ?? item.current_period_end),
      cancelAtPeriodEnd: typeof object.cancel_at_period_end === "boolean" ? object.cancel_at_period_end : null,
    };
  }
  return null;
}

export function razorpayEventToUpdate(event: Json): SubscriptionUpdate | null {
  const type = str(event.event) ?? "";
  const sub = obj(obj(obj(event.payload).subscription).entity);
  const notes = obj(sub.notes);
  const org = str(notes.organisation_id);
  if (!org || !type.startsWith("subscription.")) return null;
  const status = mapRazorpayStatus(type, String(sub.status ?? ""));
  if (!status) return null;
  return {
    organisationId: org, planId: str(notes.plan_id), status, interval: interval(notes.interval), provider: "razorpay",
    customerId: str(sub.customer_id), subscriptionId: str(sub.id),
    periodStart: iso(sub.current_start), periodEnd: iso(sub.current_end),
    cancelAtPeriodEnd: status === "cancelled" ? false : null,
  };
}
