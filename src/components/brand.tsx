import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex size-9 items-center justify-center rounded-xl bg-brand-700 text-white shadow-sm", className)} aria-hidden>
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 7.5A6.5 6.5 0 1 0 17 16.5" />
        <path d="M12 12h9m0 0-3-3m3 3-3 3" />
      </svg>
    </span>
  );
}

export function Logo({ className, light }: { className?: string; light?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className={light ? "bg-white/10 ring-1 ring-white/20" : undefined} />
      <span className={cn("text-lg font-semibold tracking-tight", light ? "text-white" : "text-ink")}>Capflow</span>
    </span>
  );
}
