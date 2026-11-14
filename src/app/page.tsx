import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BellRing, Bot, Check, FileSpreadsheet, HandCoins, LineChart, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { Logo } from "@/components/brand";

export const metadata: Metadata = { title: "Capflow — Get paid. Without chasing." };

const FEATURES = [
  { icon: BellRing, title: "Reminders that follow up for you", text: "A sequence you control: a friendly note before the due date, a nudge on the day, firmer follow-ups after, and escalation to a person when it matters." },
  { icon: Sparkles, title: "Messages written for each customer", text: "AI personalises each reminder from the invoice and the customer's history, within strict rules: no threats, no invented consequences." },
  { icon: HandCoins, title: "Partial payments and promises", text: "Apply one payment across several invoices, record promised dates, and get a follow-up task the moment a promise is missed." },
  { icon: LineChart, title: "Know where your cash is", text: "Outstanding, overdue, ageing, DSO and collection effectiveness, calculated from your own ledger in each currency." },
  { icon: FileSpreadsheet, title: "Bring what you have", text: "Import customers, open invoices and payments from CSV exports of Tally, Zoho, QuickBooks or a spreadsheet." },
  { icon: ShieldCheck, title: "Built like finance software", text: "Database-enforced tenant isolation, an immutable payment ledger, role-based permissions and a full audit trail." },
];

const PLANS = [
  { name: "Starter", price: "₹499", note: "For freelancers and very small teams", items: ["1 user", "50 invoices a month", "Automated email reminders", "Basic analytics"] },
  { name: "Growth", price: "₹1,499", note: "For growing businesses", items: ["3 users", "500 invoices a month", "AI-personalised reminders", "Payment promise tracking", "Advanced analytics"], featured: true },
  { name: "Business", price: "₹3,999", note: "For finance teams", items: ["15 users", "5,000 invoices a month", "Bulk operations", "Team permissions", "Priority support"] },
  { name: "Enterprise", price: "Custom", note: "For larger organisations", items: ["Custom limits", "Custom integrations", "Dedicated support"] },
];

export default function LandingPage() {
  return (
    <div className="bg-brand-950 text-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Logo light />
        <nav className="flex items-center gap-2 text-sm">
          <a href="#pricing" className="hidden rounded-xl px-3 py-2 text-white/75 hover:text-white sm:block">Pricing</a>
          <Link href="/login" className="rounded-xl px-3 py-2 text-white/75 hover:text-white">Sign in</Link>
          <Link href="/signup" className="rounded-xl border border-white/25 px-4 py-2 font-medium hover:bg-white/10">Start free trial</Link>
        </nav>
      </header>

      <section className="relative mx-auto max-w-6xl overflow-hidden px-6 pt-16 pb-24 md:pt-24">
        <div className="pointer-events-none absolute top-0 -right-40 size-[38rem] rounded-full bg-brand-500/25 blur-3xl" aria-hidden />
        <div className="relative grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="text-xs font-medium tracking-[0.2em] text-brand-300 uppercase">Accounts receivable automation</p>
            <h1 className="mt-4 text-5xl leading-[1.05] font-semibold tracking-tight md:text-6xl">Get paid.<br />Without chasing.</h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-white/70">Capflow helps businesses collect money they are already owed. It tracks every unpaid invoice and follows up politely and persistently until the payment arrives.</p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link href="/signup" className="inline-flex h-12 items-center gap-2 rounded-xl bg-white px-6 text-[15px] font-semibold text-brand-950 hover:bg-brand-50">Start 14-day free trial<ArrowRight className="size-4" /></Link>
              <span className="text-sm text-white/55">No card required</span>
            </div>
          </div>
          <div className="relative">
            <div className="rounded-3xl border border-white/15 bg-white/[0.06] p-6 backdrop-blur-sm">
              <p className="text-sm text-white/60">Recovered this month</p>
              <p className="mt-1 text-4xl font-semibold tracking-tight tabular">₹4,82,300</p>
              <div className="mt-6 space-y-3">
                {[["Friendly reminder", "5 days before due", "Sent"], ["Payment due today", "On the due date", "Sent"], ["First overdue reminder", "3 days overdue", "Awaiting approval"], ["Escalate to finance", "14 days overdue", "Scheduled"]].map(([a, b, c]) => (
                  <div key={a} className="flex items-center justify-between rounded-xl bg-white/[0.06] px-4 py-3 text-sm">
                    <div><p className="font-medium">{a}</p><p className="text-xs text-white/50">{b}</p></div>
                    <span className="rounded-full bg-brand-500/25 px-2.5 py-0.5 text-xs text-brand-200">{c}</span>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-[11px] text-white/35">Illustration of a recovery sequence</p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-canvas py-24 text-ink">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="max-w-2xl text-3xl font-semibold tracking-tight md:text-4xl">Everything between “invoice sent” and “payment received”.</h2>
          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-card border border-line bg-surface p-6">
                <span className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><f.icon className="size-5" /></span>
                <h3 className="mt-5 text-base font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{f.text}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 grid gap-4 rounded-card border border-line bg-surface p-6 md:grid-cols-3">
            {[[Bot, "You stay in control", "Start with every message waiting for your approval. Switch to automatic once you trust the sequence."], [LockKeyhole, "Disputes go to people", "A disputed invoice stops all automation until someone on your team resolves it."], [ShieldCheck, "No made-up numbers", "Payments are only recorded from verified entries. AI never touches balances."]].map(([Icon, t, d]) => {
              const I = Icon as typeof Bot;
              return <div key={t as string} className="flex gap-3"><I className="mt-0.5 size-5 shrink-0 text-brand-700" /><div><p className="text-sm font-semibold">{t as string}</p><p className="mt-1 text-[13px] text-muted">{d as string}</p></div></div>;
            })}
          </div>
        </div>
      </section>

      <section id="pricing" className="bg-canvas pb-24 text-ink">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-3xl font-semibold tracking-tight">Simple pricing</h2>
          <p className="mt-2 text-muted">Every plan starts with a 14-day trial of Growth. Prices per month, excluding GST. USD pricing available at checkout.</p>
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {PLANS.map((p) => (
              <div key={p.name} className={`flex flex-col rounded-card border bg-surface p-6 ${p.featured ? "border-brand-600 ring-1 ring-brand-600" : "border-line"}`}>
                <h3 className="font-semibold">{p.name}</h3>
                <p className="mt-1 text-[13px] text-muted">{p.note}</p>
                <p className="mt-5 text-3xl font-semibold tracking-tight">{p.price}{p.price !== "Custom" ? <span className="text-sm font-normal text-muted">/month</span> : null}</p>
                <ul className="mt-5 flex-1 space-y-2 text-sm">{p.items.map((i) => <li key={i} className="flex gap-2"><Check className="mt-0.5 size-4 text-brand-600" />{i}</li>)}</ul>
                <Link href="/signup" className={`mt-6 inline-flex h-10 items-center justify-center rounded-xl text-sm font-medium ${p.featured ? "bg-brand-700 text-white hover:bg-brand-800" : "border border-line-strong hover:bg-subtle"}`}>{p.price === "Custom" ? "Talk to us" : "Start free trial"}</Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-10 text-sm text-white/50">
        <Logo light />
        <p>© {new Date().getFullYear()} Capflow</p>
      </footer>
    </div>
  );
}
