import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { Logo } from "@/components/brand";
import { env, isSupabaseConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Setup" };
export const dynamic = "force-dynamic";

export default function SetupPage() {
  if (isSupabaseConfigured() && process.env.NODE_ENV === "production") redirect("/login");
  const checks = [
    { name: "NEXT_PUBLIC_SUPABASE_URL", ok: env.supabaseUrl() !== null, required: true, note: "Supabase project URL" },
    { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", ok: env.supabaseAnonKey() !== null, required: true, note: "Supabase anon / publishable key" },
    { name: "SUPABASE_SERVICE_ROLE_KEY", ok: env.supabaseServiceKey() !== null, required: true, note: "Server-only: webhooks, rate limiting, integration secrets" },
    { name: "APP_ENCRYPTION_KEY", ok: env.encryptionKey() !== null, required: true, note: "32 random bytes (base64) for secrets and unsubscribe links" },
    { name: "RESEND_API_KEY + EMAIL_FROM", ok: env.resendKey() !== null && env.emailFrom() !== null, required: false, note: "Live email. Without it, email stays in sandbox mode" },
    { name: "STRIPE_SECRET_KEY", ok: env.stripeKey() !== null, required: false, note: "International subscription checkout" },
    { name: "RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET", ok: env.razorpayKeyId() !== null && env.razorpayKeySecret() !== null, required: false, note: "India subscription checkout" },
  ];
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <Logo />
      <h1 className="mt-8 text-2xl font-semibold tracking-tight">Finish configuring Capflow</h1>
      <p className="mt-1 text-sm text-muted">
        Copy <code className="rounded bg-line px-1 font-mono text-xs">.env.example</code> to{" "}
        <code className="rounded bg-line px-1 font-mono text-xs">.env.local</code>, fill in the values below, apply the database
        migrations in <code className="rounded bg-line px-1 font-mono text-xs">supabase/migrations</code>, then restart the app. The README has step-by-step instructions.
      </p>
      <ul className="mt-6 divide-y divide-line rounded-2xl border border-line bg-surface">
        {checks.map((c) => (
          <li key={c.name} className="flex items-start gap-3 px-5 py-4">
            {c.ok ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand-600" /> : <CircleAlert className={`mt-0.5 size-5 shrink-0 ${c.required ? "text-danger-600" : "text-faint"}`} />}
            <div>
              <p className="font-mono text-[13px] font-medium">{c.name}</p>
              <p className="text-[13px] text-muted">{c.note} · {c.ok ? "configured" : c.required ? "required, missing" : "optional, not configured"}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
