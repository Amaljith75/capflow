"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, Sparkles } from "lucide-react";
import { Logo } from "@/components/brand";
import { cn } from "@/lib/utils";
import { NAV } from "./nav";

export interface SidebarProps {
  badges: { approvals: number };
  plan: { label: string; note: string; cta: boolean };
  onNavigate?: () => void;
  onSearch?: () => void;
}

export function SidebarContent({ badges, plan, onNavigate, onSearch }: SidebarProps) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col gap-5 p-4">
      <Link href="/dashboard" onClick={onNavigate} className="px-1 pt-1" aria-label="Capflow overview"><Logo /></Link>
      <button
        type="button"
        onClick={onSearch}
        className="flex h-10 items-center gap-2 rounded-xl border border-line bg-subtle px-3 text-[13px] text-muted transition-colors hover:border-line-strong"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search</span>
        <kbd className="rounded-md border border-line bg-surface px-1.5 font-mono text-[11px] text-faint">⌘K</kbd>
      </button>
      <nav className="flex flex-1 flex-col gap-5 overflow-y-auto" aria-label="Main">
        {NAV.map((group) => (
          <div key={group.heading}>
            <p className="mb-1.5 px-3 text-[11px] font-medium tracking-wider text-faint uppercase">{group.heading}</p>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const badge = item.badgeKey ? badges[item.badgeKey] : 0;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors",
                        active ? "bg-ink text-white shadow-sm" : "text-ink-soft hover:bg-subtle",
                      )}
                    >
                      <item.icon className={cn("size-[18px]", active ? "text-white" : "text-muted")} />
                      <span className="flex-1">{item.label}</span>
                      {badge > 0 ? (
                        <span className={cn("rounded-full px-1.5 text-[11px] tabular", active ? "bg-white/20 text-white" : "bg-brand-100 text-brand-800")}>{badge}</span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="rounded-2xl border border-line bg-gradient-to-b from-brand-50 to-surface p-4">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Sparkles className="size-4 text-brand-600" />{plan.label}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">{plan.note}</p>
        {plan.cta ? (
          <Link href="/billing" onClick={onNavigate} className="mt-3 inline-flex h-8 items-center rounded-lg bg-brand-700 px-3 text-xs font-medium text-white hover:bg-brand-800">
            View plans
          </Link>
        ) : null}
      </div>
    </div>
  );
}
