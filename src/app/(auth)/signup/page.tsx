import type { Metadata } from "next";
import Link from "next/link";
import { param } from "@/lib/utils";
import { SignupForm } from "../forms";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Start recovering what you&apos;re owed</h1>
      <p className="mt-1 mb-8 text-sm text-muted">14-day free trial. No card required.</p>
      <SignupForm next={param(sp.next)} email={param(sp.email)} />
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account? <Link href="/login" className="font-medium text-brand-700 hover:underline">Sign in</Link>
      </p>
    </>
  );
}
