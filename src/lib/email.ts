import "server-only";
import { env } from "@/lib/env";

export type EmailResult = { sent: true; id: string } | { sent: false; reason: "not_configured" | "provider_error"; detail?: string };

/** Transactional email from the web app (invitations, test messages). Reminder emails are sent by the worker. */
export async function sendEmail(input: { to: string; subject: string; text: string; replyTo?: string }): Promise<EmailResult> {
  const key = env.resendKey();
  const from = env.emailFrom();
  if (!key || !from) return { sent: false, reason: "not_configured" };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [input.to], subject: input.subject, text: input.text, reply_to: input.replyTo }),
      cache: "no-store",
    });
    const json = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!response.ok || !json.id) return { sent: false, reason: "provider_error", detail: json.message ?? `HTTP ${response.status}` };
    return { sent: true, id: json.id };
  } catch (e) {
    return { sent: false, reason: "provider_error", detail: e instanceof Error ? e.message : "network error" };
  }
}

export function emailIsLive(): boolean {
  return env.resendKey() !== null && env.emailFrom() !== null;
}
