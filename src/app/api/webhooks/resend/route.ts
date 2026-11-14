import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifySvixSignature } from "@/lib/webhook-signatures";

const STATUS: Record<string, string> = {
  "email.sent": "sent", "email.delivered": "delivered", "email.opened": "opened", "email.bounced": "bounced",
  "email.complained": "complained", "email.failed": "failed", "email.delivery_delayed": "sent",
};

export async function POST(request: NextRequest) {
  const secret = env.resendWebhookSecret();
  const admin = createAdminClient();
  if (!secret || !admin) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const body = await request.text();
  const ok = verifySvixSignature(body, {
    id: request.headers.get("svix-id"), timestamp: request.headers.get("svix-timestamp"), signature: request.headers.get("svix-signature"),
  }, secret);
  if (!ok) return NextResponse.json({ error: "invalid signature" }, { status: 400 });

  const event = JSON.parse(body) as { type?: string; data?: { email_id?: string; bounce?: { message?: string } } };
  const status = STATUS[event.type ?? ""];
  const id = event.data?.email_id;
  if (status && id) {
    const { error } = await admin.rpc("apply_delivery_status", { p_provider: "resend", p_message_id: id, p_status: status, p_error: event.data?.bounce?.message ?? null });
    if (error) return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
