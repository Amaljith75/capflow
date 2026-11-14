"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { fail, zodFail, type ActionResult } from "@/lib/result";

const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address."));
const password = z.string().min(10, "Use at least 10 characters.").max(72, "Use at most 72 characters.");

const signUpSchema = z.object({
  full_name: z.string().trim().min(2, "Enter your name.").max(100),
  email,
  password,
});

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export async function signUp(_: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodFail(parsed.error.issues);
  if (!(await rateLimit(`signup:${await clientIp()}`, 5, 3600))) return fail("Too many attempts. Please try again later.");

  const next = safeNext(formData.get("next"));
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.full_name },
      emailRedirectTo: `${env.appUrl()}/auth/callback?next=${encodeURIComponent(next === "/dashboard" ? "/onboarding" : next)}`,
    },
  });
  if (error) {
    if (error.code === "weak_password") return fail("That password is too easy to guess. Choose a stronger one.");
    if (error.code === "over_email_send_rate_limit") return fail("Too many emails sent. Please wait a minute and try again.");
    return fail("We couldn't create your account. Please check your details and try again.");
  }
  if (data.session) redirect(next === "/dashboard" ? "/onboarding" : next);
  // Same message whether or not the address already has an account (no user enumeration).
  return { ok: true, message: "Check your inbox to verify your email address." };
}

export async function signIn(_: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ email, password: z.string().min(1, "Enter your password.") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodFail(parsed.error.issues);
  const ip = await clientIp();
  if (!(await rateLimit(`login:${ip}`, 10, 600)) || !(await rateLimit(`login:${parsed.data.email}`, 10, 600))) {
    return fail("Too many sign-in attempts. Please wait a few minutes.");
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "email_not_confirmed") return fail("Please verify your email address first. Check your inbox for the link.");
    return fail("Incorrect email or password.");
  }
  redirect(safeNext(formData.get("next")));
}

export async function requestPasswordReset(_: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ email }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodFail(parsed.error.issues);
  if (!(await rateLimit(`reset:${await clientIp()}`, 5, 3600))) return fail("Too many attempts. Please try again later.");
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${env.appUrl()}/auth/callback?next=/reset-password`,
  });
  return { ok: true, message: "If an account exists for that address, a reset link is on its way." };
}

export async function updatePassword(_: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult> {
  const parsed = z
    .object({ password, confirm: z.string() })
    .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match." })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodFail(parsed.error.issues);
  const supabase = await createClient();
  const { data: session } = await supabase.auth.getUser();
  if (!session.user) return fail("Your reset link has expired. Request a new one.");
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return fail(error.code === "same_password" ? "Choose a password you haven't used before." : "We couldn't update your password.");
  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
