import type { Metadata } from "next";
import Link from "next/link";
import { param } from "@/lib/utils";
import { LoginForm } from "../forms";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const error = param(sp.error);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1 mb-8 text-sm text-muted">Sign in to your receivables workspace.</p>
      {error ? (
        <p role="alert" className="mb-4 rounded-xl border border-danger-100 bg-danger-50 px-3 py-2.5 text-sm text-danger-700">
          {error === "link" ? "That link is invalid or has expired. Please request a new one." : "Please sign in to continue."}
        </p>
      ) : null}
      <LoginForm next={param(sp.next)} />
      <p className="mt-6 text-center text-sm text-muted">
        New to Capflow? <Link href="/signup" className="font-medium text-brand-700 hover:underline">Create an account</Link>
      </p>
    </>
  );
}
