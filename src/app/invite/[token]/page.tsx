import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { getSession, ORG_COOKIE } from "@/lib/auth/context";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { dbErrorMessage } from "@/lib/result";

export const metadata: Metadata = { title: "Invitation" };

export default async function InvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const { supabase, user } = await getSession();
  const { data } = await supabase.rpc("invitation_preview", { p_token: token });
  const invite = data as { organisation: string; email: string; role: Role; valid: boolean } | null;

  async function accept() {
    "use server";
    const { supabase: client, user: current } = await getSession();
    if (!current) redirect(`/login?next=/invite/${token}`);
    const { data: orgId, error } = await client.rpc("accept_invitation", { p_token: token });
    if (error) redirect(`/invite/${token}?error=${encodeURIComponent(dbErrorMessage(error))}`);
    (await cookies()).set(ORG_COOKIE, String(orgId), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
    redirect("/dashboard");
  }

  const error = typeof sp.error === "string" ? sp.error : null;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <Logo />
      <div className="mt-8 w-full max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-card">
        {!invite?.valid ? (
          <>
            <h1 className="text-xl font-semibold">This invitation is no longer valid</h1>
            <p className="mt-2 text-sm text-muted">It may have expired, been revoked or already been used. Ask the person who invited you for a new one.</p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">Join {invite.organisation}</h1>
            <p className="mt-2 text-sm text-muted">You were invited as <strong className="text-ink">{ROLE_LABELS[invite.role]}</strong> using {invite.email}.</p>
            {error ? <p role="alert" className="mt-4 rounded-xl border border-danger-100 bg-danger-50 px-3 py-2.5 text-sm text-danger-700">{error}</p> : null}
            {user ? (
              <form action={accept} className="mt-6">
                <Button size="lg" className="w-full">Accept invitation</Button>
                <p className="mt-3 text-xs text-muted">Signed in as {user.email}</p>
              </form>
            ) : (
              <div className="mt-6 flex flex-col gap-2">
                <Button size="lg" asChild><Link href={`/signup?next=/invite/${token}&email=${encodeURIComponent(invite.email)}`}>Create an account to accept</Link></Button>
                <Button size="lg" variant="secondary" asChild><Link href={`/login?next=/invite/${token}`}>I already have an account</Link></Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
