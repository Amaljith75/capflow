import Link from "next/link";
import { BellRing, HandCoins, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand";

const points = [
  { icon: BellRing, title: "Reminders that send themselves", text: "A configurable sequence follows every invoice from before the due date until it is paid." },
  { icon: HandCoins, title: "Promises and payments in one ledger", text: "Partial payments, payment promises and disputes update the recovery workflow automatically." },
  { icon: ShieldCheck, title: "You stay in control", text: "Approve every message, or let trusted sequences run. Every action is logged." },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <main className="flex flex-col bg-surface px-6 py-8 sm:px-12">
        <Link href="/" aria-label="Capflow home"><Logo /></Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">{children}</div>
        <p className="text-xs text-faint">© {new Date().getFullYear()} Capflow. Accounts receivable automation.</p>
      </main>
      <aside className="relative hidden overflow-hidden bg-brand-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -top-40 -right-40 size-[34rem] rounded-full bg-brand-500/30 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-52 -left-32 size-[30rem] rounded-full bg-brand-700/40 blur-3xl" aria-hidden />
        <p className="relative text-xs font-medium tracking-[0.2em] text-brand-300 uppercase">Cashflow recovery</p>
        <div className="relative max-w-md">
          <h2 className="text-4xl leading-[1.1] font-semibold tracking-tight">Get paid.<br />Without chasing.</h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/70">
            Capflow tracks every invoice you are owed and follows up for you, politely and persistently, until the money arrives.
          </p>
          <ul className="mt-10 space-y-5">
            {points.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                  <Icon className="size-[18px] text-brand-300" />
                </span>
                <div>
                  <p className="text-sm font-medium">{title}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-white/60">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/40">Row-level tenant isolation · Immutable payment audit trail</p>
      </aside>
    </div>
  );
}
