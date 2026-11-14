import "server-only";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SubscriptionUpdate } from "./events";

/**
 * Idempotent processing: each provider event id is recorded once. A replayed
 * event that was already processed returns 200 without side effects; one that
 * failed before is retried.
 */
export async function processBillingEvent(provider: string, eventId: string, eventType: string, payload: unknown, update: SubscriptionUpdate | null) {
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const { data: existing } = await admin.from("billing_events").select("id, processed_at").eq("provider", provider).eq("event_id", eventId).maybeSingle();
  if (existing?.processed_at) return NextResponse.json({ received: true, duplicate: true });
  let rowId = existing?.id as string | undefined;
  if (!rowId) {
    const { data, error } = await admin.from("billing_events")
      .insert({ provider, event_id: eventId, event_type: eventType, payload, organisation_id: update?.organisationId ?? null }).select("id").single();
    if (error) {
      if (error.code === "23505") return NextResponse.json({ received: true, duplicate: true });
      return NextResponse.json({ error: "storage failed" }, { status: 500 });
    }
    rowId = data.id;
  }

  if (update) {
    const { error } = await admin.rpc("apply_subscription_update", {
      p_org: update.organisationId, p_plan: update.planId, p_status: update.status, p_interval: update.interval, p_provider: update.provider,
      p_customer: update.customerId, p_subscription: update.subscriptionId, p_period_start: update.periodStart, p_period_end: update.periodEnd,
      p_cancel_at_end: update.cancelAtPeriodEnd,
    });
    if (error) {
      await admin.from("billing_events").update({ error: error.message }).eq("id", rowId);
      // 500 makes the provider retry later.
      return NextResponse.json({ error: "processing failed" }, { status: 500 });
    }
  }
  await admin.from("billing_events").update({ processed_at: new Date().toISOString(), error: null }).eq("id", rowId);
  return NextResponse.json({ received: true });
}
