import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { verifyUnsubscribeToken } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false } };

/** One-click unsubscribe from reminder emails. Signed link; requires no login. */
export default async function UnsubscribePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  const customerId = verifyUnsubscribeToken(token);

  async function confirm() {
    "use server";
    const id = verifyUnsubscribeToken(token);
    const admin = createAdminClient();
    if (id && admin) await admin.rpc("record_opt_out", { p_customer: id, p_channel: "email", p_source: "unsubscribe_link" });
    redirect(`/u/${token}?done=1`);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <Logo />
      <div className="mt-8 w-full max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-card">
        {!customerId ? (
          <><h1 className="text-xl font-semibold">This link is not valid</h1><p className="mt-2 text-sm text-muted">Please contact the business that emailed you.</p></>
        ) : done ? (
          <><h1 className="text-xl font-semibold">You have been unsubscribed</h1><p className="mt-2 text-sm text-muted">You will no longer receive automated payment reminder emails from this business. Invoices you owe are unaffected.</p></>
        ) : (
          <>
            <h1 className="text-xl font-semibold">Stop payment reminder emails?</h1>
            <p className="mt-2 text-sm text-muted">You will no longer receive automated reminder emails sent through Capflow by this business.</p>
            <form action={confirm} className="mt-6"><Button size="lg" className="w-full">Unsubscribe</Button></form>
          </>
        )}
      </div>
    </div>
  );
}
