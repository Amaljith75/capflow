import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const configured = isSupabaseConfigured();
  let database = "unknown";
  if (configured) {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/subscription_plans?select=id&limit=1`, {
        headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }, cache: "no-store", signal: AbortSignal.timeout(3000),
      });
      database = res.ok ? "ok" : `error ${res.status}`;
    } catch {
      database = "unreachable";
    }
  }
  const ok = configured && database === "ok";
  return NextResponse.json({ status: ok ? "ok" : "degraded", configured, database }, { status: ok ? 200 : 503 });
}
