import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/**
 * Fixed-window rate limit backed by Postgres (works on serverless without Redis).
 * Returns true when the request is allowed. If the service role is not
 * configured the limiter is skipped; Supabase Auth still applies its own limits.
 */
export async function rateLimit(bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  const admin = createAdminClient();
  if (!admin) return true;
  const { data, error } = await admin.rpc("rate_limit_hit", { p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds });
  if (error) {
    console.error("[capflow] rate limiter unavailable", error.message);
    return true;
  }
  return data === true;
}
