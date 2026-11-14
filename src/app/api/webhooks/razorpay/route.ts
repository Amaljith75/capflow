import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { razorpayEventToUpdate } from "@/lib/billing/events";
import { processBillingEvent } from "@/lib/billing/webhook";
import { env } from "@/lib/env";
import { verifyRazorpaySignature } from "@/lib/webhook-signatures";

export async function POST(request: NextRequest) {
  const secret = env.razorpayWebhookSecret();
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const body = await request.text();
  if (!verifyRazorpaySignature(body, request.headers.get("x-razorpay-signature"), secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }
  const event = JSON.parse(body) as Record<string, unknown>;
  const eventId = request.headers.get("x-razorpay-event-id") ?? `body:${createHash("sha256").update(body).digest("hex")}`;
  return processBillingEvent("razorpay", eventId, String(event.event), event, razorpayEventToUpdate(event));
}
