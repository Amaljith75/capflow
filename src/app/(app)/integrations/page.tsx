import type { Metadata } from "next";
import { Bot, Building, Mail, MessageCircle, Settings2, Smartphone } from "lucide-react";
import { ActionButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { getEntitlements, requireContext } from "@/lib/auth/context";
import { emailIsLive } from "@/lib/email";
import { env } from "@/lib/env";
import { can } from "@/lib/permissions";
import { removeSecret, sendTestEmail } from "./actions";
import { IntegrationDialog, type FieldSpec } from "./integration-form";

export const metadata: Metadata = { title: "Integrations" };

interface Config { kind: string; enabled: boolean; settings: Record<string, string>; has_secret: boolean }

function Status({ state }: { state: "live" | "sandbox" | "off" | "plan" | "planned" }) {
  const map = {
    live: <Badge tone="green" dot>Connected</Badge>,
    sandbox: <Badge tone="amber" dot>Sandbox: messages are logged, not delivered</Badge>,
    off: <Badge dot>Not configured</Badge>,
    plan: <Badge tone="blue">Upgrade required</Badge>,
    planned: <Badge>Not available yet</Badge>,
  };
  return map[state];
}

export default async function IntegrationsPage() {
  const { supabase, org, role } = await requireContext();
  const entitlements = await getEntitlements();
  const isAdmin = can(role, "admin");
  const { data } = await supabase.from("integration_configs").select("kind, enabled, settings, has_secret").eq("organisation_id", org.id);
  const configs = new Map(((data ?? []) as Config[]).map((c) => [c.kind, c]));
  const get = (kind: string): Config => configs.get(kind) ?? { kind, enabled: false, settings: {}, has_secret: false };
  const email = get("email"), whatsapp = get("whatsapp"), sms = get("sms"), ai = get("ai");

  const rows: {
    kind: string; icon: typeof Mail; name: string; text: string; state: "live" | "sandbox" | "off" | "plan" | "planned";
    config?: Config; fields?: FieldSpec[]; secretLabel?: string; extra?: React.ReactNode; webhook?: string;
  }[] = [
    {
      kind: "email", icon: Mail, name: "Email (Resend)",
      text: "Sends reminder emails with an unsubscribe link and tracks delivery, bounces and complaints. The sending domain and API key are set by the platform operator; here you set how messages appear to customers.",
      state: emailIsLive() ? "live" : "sandbox", config: email,
      fields: [
        { name: "from_name", label: "Sender name", placeholder: org.name, hint: "Shown as the From name on reminders." },
        { name: "reply_to", label: "Reply-to address", placeholder: "accounts@yourcompany.com", hint: "Customer replies go here." },
      ],
      extra: isAdmin ? <ActionButton size="sm" variant="secondary" action={sendTestEmail}>Send test email</ActionButton> : null,
      webhook: "/api/webhooks/resend",
    },
    {
      kind: "ai", icon: Bot, name: "AI personalisation",
      text: "Rewrites reminder drafts using the invoice and customer history. Output is checked against a schema and safety rules (no threats, no invented legal consequences, no false payment claims). If the AI fails, the template is used.",
      state: !entitlements.limits.ai_reminders ? "plan" : ai.enabled && ai.has_secret ? "live" : "off", config: ai,
      fields: [
        { name: "provider", label: "Provider", options: [
          { value: "openrouter", label: "OpenRouter" }, { value: "anthropic", label: "Anthropic" }, { value: "openai", label: "OpenAI" }, { value: "openai_compatible", label: "Other OpenAI-compatible API" },
        ] },
        { name: "model", label: "Model", placeholder: "e.g. anthropic/claude-sonnet-5.5", hint: "Use the model id exactly as your provider names it." },
        { name: "base_url", label: "Base URL (OpenAI-compatible only)", placeholder: "https://api.example.com/v1" },
      ],
      secretLabel: "API key",
    },
    {
      kind: "whatsapp", icon: MessageCircle, name: "WhatsApp Business (Cloud API)",
      text: "Sends pre-approved template messages through Meta's official WhatsApp Business Platform, only to customers who have opted in. Requires a verified Meta Business account and an approved payment-reminder template.",
      state: !entitlements.limits.whatsapp ? "plan" : whatsapp.enabled && whatsapp.has_secret ? "live" : "off", config: whatsapp,
      fields: [
        { name: "phone_number_id", label: "Phone Number ID" },
        { name: "template_name", label: "Approved template name", placeholder: "payment_reminder" },
        { name: "template_language", label: "Template language", placeholder: "en" },
      ],
      secretLabel: "Permanent access token",
      webhook: "/api/webhooks/whatsapp",
    },
    {
      kind: "sms", icon: Smartphone, name: "SMS (Twilio)",
      text: "Sends short reminders by SMS to customers who have opted in. Delivery receipts update the communication log.",
      state: !entitlements.limits.sms ? "plan" : sms.enabled && sms.has_secret ? "live" : "off", config: sms,
      fields: [
        { name: "account_sid", label: "Account SID", placeholder: "AC…" },
        { name: "from_number", label: "Sending number", placeholder: "+14155550100" },
      ],
      secretLabel: "Auth token",
      webhook: "/api/webhooks/twilio",
    },
    {
      kind: "bank", icon: Building, name: "Bank feeds and accounting software",
      text: "Automatic payment matching from bank feeds, Tally, Zoho Books, QuickBooks and Xero. Not connected: the data model is ready (payments carry a source), but no provider integration exists yet. Use CSV import in the meantime.",
      state: "planned",
    },
  ];

  return (
    <>
      <PageHeader title="Integrations" description="Connect delivery channels and AI. Nothing is reported as delivered unless a real provider accepted it." />
      <div className="flex flex-col gap-4">
        {rows.map((r) => (
          <Card key={r.kind} className="p-5">
            <div className="flex flex-wrap items-start gap-4">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-subtle"><r.icon className="size-5 text-brand-700" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><h2 className="text-[15px] font-semibold">{r.name}</h2><Status state={r.state} /></div>
                <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted">{r.text}</p>
                {r.webhook && r.state !== "plan" ? <p className="mt-2 text-xs text-faint">Webhook URL: <code className="font-mono">{env.appUrl()}{r.webhook}</code></p> : null}
              </div>
              {isAdmin && r.fields && r.config && r.state !== "plan" ? (
                <div className="flex flex-wrap gap-2">
                  {r.extra}
                  {r.config.has_secret ? <ActionButton size="sm" variant="ghost" action={removeSecret.bind(null, r.kind)} confirm={{ title: "Remove credentials?", description: "The stored key is deleted and the integration is disabled.", confirmLabel: "Remove", danger: true }}>Remove key</ActionButton> : null}
                  <IntegrationDialog kind={r.kind} title={r.name} description="Settings are visible to your team. Keys are encrypted and write-only."
                    fields={r.fields} settings={r.config.settings} enabled={r.config.enabled} hasSecret={r.config.has_secret} secretLabel={r.secretLabel}
                    trigger={<Button size="sm" variant="secondary"><Settings2 />Configure</Button>} />
                </div>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
