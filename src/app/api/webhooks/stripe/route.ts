import { NextResponse, type NextRequest } from "next/server";
import { stripeEventToUpdate } from "@/lib/billing/events";
import { processBillingEvent } from "@/lib/billing/webhook";
import { env } from "@/lib/env";
import { verifyStripeSignature } from "@/lib/webhook-signatures";

export async function POST(request: NextRequest) {
  const secret = env.stripeWebhookSecret();
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const body = await request.text();
  if (!verifyStripeSignature(body, request.headers.get("stripe-signature"), secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }
  const event = JSON.parse(body) as Record<string, unknown>;
  return processBillingEvent("stripe", String(event.id), String(event.type), event, stripeEventToUpdate(event));
}
