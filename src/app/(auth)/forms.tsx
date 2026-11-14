"use client";

import Link from "next/link";
import { useState } from "react";
import { MailCheck } from "lucide-react";
import { ActionForm, FormField, SubmitButton } from "@/components/ui/action-form";
import { Input } from "@/components/ui/input";
import { requestPasswordReset, signIn, signUp, updatePassword } from "./actions";

function Sent({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-brand-200 bg-brand-50 p-6 text-center">
      <MailCheck className="mx-auto size-8 text-brand-700" />
      <h2 className="mt-3 text-base font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted">{text}</p>
    </div>
  );
}

export function LoginForm({ next }: { next?: string }) {
  return (
    <ActionForm action={signIn} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <FormField name="email" label="Work email">
        <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@company.com" />
      </FormField>
      <FormField name="password" label="Password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </FormField>
      <div className="-mt-1 text-right">
        <Link href="/forgot-password" className="text-[13px] font-medium text-brand-700 hover:underline">Forgot password?</Link>
      </div>
      <SubmitButton size="lg" className="mt-1 w-full">Sign in</SubmitButton>
    </ActionForm>
  );
}

export function SignupForm({ next, email }: { next?: string; email?: string }) {
  const [sent, setSent] = useState<string | null>(null);
  if (sent) return <Sent title="Verify your email" text={sent} />;
  return (
    <ActionForm action={signUp} className="flex flex-col gap-4" onSuccess={(r) => setSent(r.message ?? "Check your inbox.")}>
      <input type="hidden" name="next" value={next ?? ""} />
      <FormField name="full_name" label="Full name">
        <Input id="full_name" name="full_name" autoComplete="name" required />
      </FormField>
      <FormField name="email" label="Work email">
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={email} placeholder="you@company.com" />
      </FormField>
      <FormField name="password" label="Password" hint="At least 10 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
      </FormField>
      <SubmitButton size="lg" className="mt-1 w-full">Create account</SubmitButton>
    </ActionForm>
  );
}

export function ForgotForm() {
  const [sent, setSent] = useState<string | null>(null);
  if (sent) return <Sent title="Check your inbox" text={sent} />;
  return (
    <ActionForm action={requestPasswordReset} className="flex flex-col gap-4" onSuccess={(r) => setSent(r.message ?? "")}>
      <FormField name="email" label="Work email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </FormField>
      <SubmitButton size="lg" className="w-full">Send reset link</SubmitButton>
    </ActionForm>
  );
}

export function ResetForm() {
  return (
    <ActionForm action={updatePassword} className="flex flex-col gap-4">
      <FormField name="password" label="New password" hint="At least 10 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
      </FormField>
      <FormField name="confirm" label="Confirm new password">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </FormField>
      <SubmitButton size="lg" className="w-full">Update password</SubmitButton>
    </ActionForm>
  );
}
