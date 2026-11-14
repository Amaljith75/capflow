import type { Metadata } from "next";
import Link from "next/link";
import { ForgotForm } from "../forms";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-1 mb-8 text-sm text-muted">Enter your email and we&apos;ll send you a link to choose a new password.</p>
      <ForgotForm />
      <p className="mt-6 text-center text-sm text-muted">
        <Link href="/login" className="font-medium text-brand-700 hover:underline">Back to sign in</Link>
      </p>
    </>
  );
}
