import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyTwilioSignature } from "@/lib/webhook-signatures";

const STATUS: Record<string, string> = { sent: "sent", delivered: "delivered", undelivered: "failed", failed: "failed" };
const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);

/** Status callbacks and inbound messages. Twilio itself also enforces STOP for SMS. */
export async function POST(request: NextRequest) {
  const token = env.twilioAuthToken();
  const admin = createAdminClient();
  if (!token || !admin) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const form = await request.formData();
  const params = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const url = `${env.appUrl()}/api/webhooks/twilio`;
  if (!verifyTwilioSignature(url, params, request.headers.get("x-twilio-signature"), token)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }
  const status = STATUS[params.MessageStatus ?? ""];
  if (status && params.MessageSid) {
    await admin.rpc("apply_delivery_status", { p_provider: "twilio", p_message_id: params.MessageSid, p_status: status, p_error: params.ErrorCode ? `Twilio error ${params.ErrorCode}` : null });
  }
  if (params.Body && params.From && STOP_WORDS.has(params.Body.trim().toLowerCase())) {
    await admin.rpc("opt_out_by_phone", { p_phone: params.From, p_channel: "sms" });
  }
  return new NextResponse("<Response></Response>", { headers: { "Content-Type": "text/xml" } });
}
