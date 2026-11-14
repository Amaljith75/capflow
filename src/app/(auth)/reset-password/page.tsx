import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/context";
import { ResetForm } from "../forms";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage() {
  const { user } = await getSession();
  if (!user) redirect("/login?error=link");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-1 mb-8 text-sm text-muted">Signed in as {user.email}.</p>
      <ResetForm />
    </>
  );
}
