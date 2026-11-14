import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyMetaSignature } from "@/lib/webhook-signatures";

/** Meta subscription verification handshake. */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const token = env.whatsappVerifyToken();
  if (token && p.get("hub.mode") === "subscribe" && safeEqual(p.get("hub.verify_token") ?? "", token)) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

const STATUS: Record<string, string> = { sent: "sent", delivered: "delivered", read: "opened", failed: "failed" };
const STOP_WORDS = new Set(["stop", "unsubscribe", "opt out", "optout", "cancel"]);

export async function POST(request: NextRequest) {
  const secret = env.whatsappAppSecret();
  const admin = createAdminClient();
  if (!secret || !admin) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const body = await request.text();
  if (!verifyMetaSignature(body, request.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }
  const payload = JSON.parse(body) as { entry?: { changes?: { value?: { statuses?: { id: string; status: string; errors?: { title?: string }[] }[]; messages?: { from: string; text?: { body?: string } }[] } }[] }[] };
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const s of change.value?.statuses ?? []) {
        const status = STATUS[s.status];
        if (status) await admin.rpc("apply_delivery_status", { p_provider: "whatsapp", p_message_id: s.id, p_status: status, p_error: s.errors?.[0]?.title ?? null });
      }
      for (const m of change.value?.messages ?? []) {
        if (STOP_WORDS.has((m.text?.body ?? "").trim().toLowerCase())) await admin.rpc("opt_out_by_phone", { p_phone: m.from, p_channel: "whatsapp" });
      }
    }
  }
  return NextResponse.json({ received: true });
}
