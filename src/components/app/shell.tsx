"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, Building2, Check, ChevronRight, ChevronsUpDown, FileText, Loader2, LogOut, Menu, Plus, Search, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { cn, initials } from "@/lib/utils";
import { globalSearch, markNotificationsRead, switchOrganisation, type SearchHit } from "@/app/(app)/shell-actions";
import { navLabel } from "./nav";
import { SidebarContent, type SidebarProps } from "./sidebar";

export interface ShellProps {
  user: { email: string; name: string | null };
  org: { id: string; name: string };
  orgs: { id: string; name: string; role: string }[];
  notifications: { id: string; title: string; body: string | null; link: string | null; created: string; unread: boolean }[];
  sidebar: Pick<SidebarProps, "badges" | "plan">;
  signOut: () => Promise<void>;
  children: React.ReactNode;
}

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (query.trim().length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await globalSearch(query);
        if (!cancelled) setHits(result);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const go = (href: string) => {
    onOpenChange(false);
    setQuery("");
    router.push(href);
  };
  const visible = query.trim().length < 2 ? [] : hits;
  const shortcuts = [
    { label: "New invoice", href: "/invoices/new", icon: Plus },
    { label: "New customer", href: "/customers?new=1", icon: Plus },
    { label: "Record a payment", href: "/payments?record=1", icon: Plus },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Search" description="Find invoices and customers" className="top-24 max-w-xl translate-y-0 [&>div:first-child]:sr-only [&>div:last-child]:p-0">
        <div className="flex items-center gap-3 border-b border-line px-4">
          {loading ? <Loader2 className="size-4 animate-spin text-muted" /> : <Search className="size-4 text-muted" />}
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && visible[0]) go(visible[0].href);
            }}
            placeholder="Search invoice numbers, customer names or emails…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
            aria-label="Search"
          />
        </div>
        <ul className="max-h-80 overflow-y-auto p-2">
          {visible.length === 0 && query.trim().length >= 2 && !loading ? (
            <li className="px-3 py-6 text-center text-sm text-muted">No invoices or customers match “{query}”.</li>
          ) : null}
          {visible.map((hit) => (
            <li key={`${hit.type}-${hit.id}`}>
              <button type="button" onClick={() => go(hit.href)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-subtle">
                {hit.type === "invoice" ? <FileText className="size-4 text-muted" /> : <Building2 className="size-4 text-muted" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{hit.title}</span>
                  <span className="block truncate text-xs text-muted">{hit.subtitle}</span>
                </span>
                <ChevronRight className="size-4 text-faint" />
              </button>
            </li>
          ))}
          {query.trim().length < 2
            ? shortcuts.map((s) => (
                <li key={s.href}>
                  <button type="button" onClick={() => go(s.href)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-subtle">
                    <s.icon className="size-4 text-muted" />{s.label}
                  </button>
                </li>
              ))
            : null}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export function AppShell({ user, org, orgs, notifications, sidebar, signOut, children }: ShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [, startTransition] = React.useTransition();
  const unread = notifications.filter((n) => n.unread).length;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const changeOrg = (id: string) =>
    startTransition(async () => {
      const result = await switchOrganisation(id);
      if (!result.ok) toast.error(result.error);
      else {
        router.push("/dashboard");
        router.refresh();
      }
    });

  const sidebarProps: SidebarProps = { ...sidebar, onSearch: () => { setMobileOpen(false); setSearchOpen(true); } };

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-surface lg:block">
        <SidebarContent {...sidebarProps} />
      </aside>
      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent title="Navigation" side="left">
          <SidebarContent {...sidebarProps} onNavigate={() => setMobileOpen(false)} />
        </DialogContent>
      </Dialog>
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />

      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur sm:px-8">
        <button type="button" onClick={() => setMobileOpen(true)} className="rounded-xl border border-line bg-surface p-2 lg:hidden" aria-label="Open navigation">
          <Menu className="size-4" />
        </button>
        <nav className="flex min-w-0 items-center gap-1.5 text-sm" aria-label="Breadcrumb">
          <span className="hidden truncate text-muted sm:inline">{org.name}</span>
          <ChevronRight className="hidden size-4 text-faint sm:inline" />
          <span className="truncate font-medium">{navLabel(pathname)}</span>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setSearchOpen(true)} className="rounded-xl border border-line bg-surface p-2.5 text-ink-soft hover:bg-subtle lg:hidden" aria-label="Search">
            <Search className="size-4" />
          </button>

          <Dropdown onOpenChange={(open) => { if (!open && unread > 0) startTransition(async () => { await markNotificationsRead(); }); }}>
            <DropdownTrigger className="relative rounded-xl border border-line bg-surface p-2.5 text-ink-soft hover:bg-subtle" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
              <Bell className="size-4" />
              {unread > 0 ? <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-danger-600 ring-2 ring-surface" /> : null}
            </DropdownTrigger>
            <DropdownContent className="w-80">
              <DropdownLabel>Notifications</DropdownLabel>
              {notifications.length === 0 ? (
                <p className="px-2.5 py-6 text-center text-[13px] text-muted">Nothing needs your attention.</p>
              ) : (
                notifications.map((n) => (
                  <DropdownItem key={n.id} asChild className="items-start">
                    <Link href={n.link ?? "/recovery"}>
                      <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.unread ? "bg-brand-600" : "bg-transparent")} />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium">{n.title}</span>
                        {n.body ? <span className="block text-xs text-muted">{n.body}</span> : null}
                        <span className="block text-[11px] text-faint">{n.created}</span>
                      </span>
                    </Link>
                  </DropdownItem>
                ))
              )}
            </DropdownContent>
          </Dropdown>

          <Dropdown>
            <DropdownTrigger className="flex h-10 items-center gap-2 rounded-xl border border-line bg-surface pr-2 pl-1.5 hover:bg-subtle" aria-label="Account and organisation menu">
              <span className="flex size-7 items-center justify-center rounded-lg bg-brand-100 text-xs font-semibold text-brand-800">{initials(user.name ?? user.email)}</span>
              <span className="hidden max-w-32 truncate text-[13px] font-medium sm:block">{user.name ?? user.email}</span>
              <ChevronsUpDown className="size-3.5 text-faint" />
            </DropdownTrigger>
            <DropdownContent className="w-64">
              <DropdownLabel>Organisations</DropdownLabel>
              {orgs.map((o) => (
                <DropdownItem key={o.id} onSelect={() => { if (o.id !== org.id) changeOrg(o.id); }}>
                  <Building2 className="text-muted" />
                  <span className="min-w-0 flex-1 truncate">{o.name}</span>
                  {o.id === org.id ? <Check className="text-brand-700" /> : null}
                </DropdownItem>
              ))}
              <DropdownItem asChild><Link href="/onboarding"><Plus className="text-muted" />New organisation</Link></DropdownItem>
              <DropdownSeparator />
              <DropdownItem asChild><Link href="/settings"><UserRound className="text-muted" />Profile &amp; settings</Link></DropdownItem>
              <DropdownItem onSelect={() => startTransition(async () => { await signOut(); })}><LogOut className="text-muted" />Sign out</DropdownItem>
            </DropdownContent>
          </Dropdown>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-8 sm:py-8">{children}</main>
    </div>
  );
}
