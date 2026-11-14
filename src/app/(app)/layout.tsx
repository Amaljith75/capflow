import Link from "next/link";
import { AppShell } from "@/components/app/shell";
import { Notice } from "@/components/ui/misc";
import { getEntitlements, requireContext } from "@/lib/auth/context";
import { formatDateTime, msUntil } from "@/lib/dates";
import { titleCase } from "@/lib/utils";
import { signOut } from "../(auth)/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const [entitlements, notifications, approvals] = await Promise.all([
    getEntitlements(),
    ctx.supabase.from("notifications").select("id, title, body, link, read_at, created_at")
      .eq("organisation_id", ctx.org.id).eq("user_id", ctx.user.id).order("created_at", { ascending: false }).limit(8),
    ctx.supabase.from("reminders").select("id", { count: "exact", head: true })
      .eq("organisation_id", ctx.org.id).eq("status", "pending_approval"),
  ]);

  const trialDays = entitlements.trial_ends_at
    ? Math.max(0, Math.ceil(msUntil(entitlements.trial_ends_at) / 86_400_000))
    : 0;
  const planName = entitlements.plan_id ? titleCase(entitlements.plan_id) : "No plan";
  const plan = !entitlements.active
    ? { label: "Subscription inactive", note: "Your data is safe and readable. Choose a plan to create invoices and send reminders again.", cta: true }
    : entitlements.status === "trialing"
      ? { label: `${planName} trial`, note: `${trialDays} day${trialDays === 1 ? "" : "s"} left. Pick a plan any time to keep automation running.`, cta: true }
      : { label: `${planName} plan`, note: `${entitlements.usage.invoices_this_month} invoices and ${entitlements.usage.reminders_this_month} reminders used this month.`, cta: false };

  return (
    <AppShell
      user={{ email: ctx.user.email, name: ctx.user.fullName }}
      org={{ id: ctx.org.id, name: ctx.org.name }}
      orgs={ctx.memberships.map((m) => ({ id: m.organisation_id, name: m.organisations.name, role: m.role }))}
      notifications={(notifications.data ?? []).map((n) => ({
        id: n.id, title: n.title, body: n.body, link: n.link, unread: n.read_at === null,
        created: formatDateTime(n.created_at, ctx.org.timezone),
      }))}
      sidebar={{ badges: { approvals: approvals.count ?? 0 }, plan }}
      signOut={signOut}
    >
      {!entitlements.active ? (
        <div className="mb-6">
          <Notice tone="warn" title="Your subscription is not active" action={<Link href="/billing" className="text-sm font-semibold underline">Go to billing</Link>}>
            You can still view and export everything. Creating invoices, recording payments and sending reminders is paused.
          </Notice>
        </div>
      ) : entitlements.status === "past_due" ? (
        <div className="mb-6">
          <Notice tone="danger" title="Your last subscription payment failed" action={<Link href="/billing" className="text-sm font-semibold underline">Update payment</Link>}>
            Please update your payment method to avoid interruption.
          </Notice>
        </div>
      ) : null}
      {children}
    </AppShell>
  );
}
