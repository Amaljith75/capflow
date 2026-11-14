import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions }: {
  title: string; description?: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action, className }: {
  icon: React.ComponentType<{ className?: string }>; title: string; description: string; action?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-line bg-subtle text-muted">
        <Icon className="size-5" />
      </div>
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-line/70", className)} />;
}

export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-2 h-8 w-48" />
      <Skeleton className="mb-6 h-4 w-72" />
      <div className="mb-4 grid gap-4 md:grid-cols-3">
        <Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" />
      </div>
      <Skeleton className="h-80" />
    </div>
  );
}

export function Notice({ tone = "info", title, children, action }: {
  tone?: "info" | "warn" | "danger" | "success"; title?: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  const styles = {
    info: "border-info-100 bg-info-100/40 text-info-700",
    warn: "border-warn-100 bg-warn-50 text-warn-700",
    danger: "border-danger-100 bg-danger-50 text-danger-700",
    success: "border-brand-200 bg-brand-50 text-brand-800",
  }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm", styles)}>
      <div>
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className={title ? "mt-0.5 opacity-90" : ""}>{children}</div>
      </div>
      {action}
    </div>
  );
}

/** Link-based tabs driven by a search param or path, so they work without client JS. */
export function Tabs({ tabs, active }: { tabs: { key: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-subtle p-1" role="tablist">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          role="tab"
          aria-selected={tab.key === active}
          className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors",
            tab.key === active ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink",
          )}
        >
          {tab.label}
          {tab.count !== undefined && tab.count > 0 ? (
            <span className={cn("rounded-full px-1.5 text-[11px] tabular", tab.key === active ? "bg-ink text-white" : "bg-line text-ink-soft")}>{tab.count}</span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}

export function Pagination({ page, pageSize, total, hrefFor }: {
  page: number; pageSize: number; total: number; hrefFor: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const linkClass = "inline-flex h-8 items-center gap-1 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] font-medium hover:bg-subtle";
  return (
    <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[13px] text-muted">
      <span className="tabular">{from}–{to} of {total}</span>
      <div className="flex gap-2">
        {page > 1 ? <Link className={linkClass} href={hrefFor(page - 1)}><ChevronLeft className="size-4" />Previous</Link> : null}
        {page < pages ? <Link className={linkClass} href={hrefFor(page + 1)}>Next<ChevronRight className="size-4" /></Link> : null}
      </div>
    </div>
  );
}

export function DefinitionList({ items, className }: { items: { label: string; value: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2", className)}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs text-muted">{item.label}</dt>
          <dd className="mt-0.5 text-sm break-words text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
