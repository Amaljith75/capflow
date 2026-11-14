import type { Metadata } from "next";
import Link from "next/link";
import { MailX, MessagesSquare, Pencil, Plus, Trash2 } from "lucide-react";
import { ActionButton } from "@/components/ui/action-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Notice, PageHeader, Pagination, Tabs } from "@/components/ui/misc";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { requireContext } from "@/lib/auth/context";
import { formatDateTime } from "@/lib/dates";
import { can } from "@/lib/permissions";
import type { Template } from "@/lib/types";
import { param, titleCase } from "@/lib/utils";
import { deleteTemplate } from "../automations/actions";
import { TemplateDialog } from "./template-dialog";

export const metadata: Metadata = { title: "Communications" };
const PAGE_SIZE = 30;

export default async function CommunicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { supabase, org, role } = await requireContext();
  const tab = ["log", "templates", "optouts"].includes(param(sp.tab) ?? "") ? param(sp.tab)! : "log";
  const page = Math.max(1, Number(param(sp.page)) || 1);
  const canEdit = can(role, "finance_manager");

  const [logs, templates, optouts, sandboxCount] = await Promise.all([
    tab === "log"
      ? supabase.from("communication_logs").select("id, channel, provider, sandbox, to_address, subject, status, error, created_at, invoice_id, customers(id, name), invoices(invoice_number)", { count: "exact" })
          .eq("organisation_id", org.id).order("created_at", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
      : Promise.resolve({ data: [], count: 0 }),
    tab === "templates" ? supabase.from("communication_templates").select("*").eq("organisation_id", org.id).order("created_at") : Promise.resolve({ data: [] }),
    tab === "optouts" ? supabase.from("customers").select("id, name, email, consent_updated_at").eq("organisation_id", org.id).eq("email_opt_out", true).order("name") : Promise.resolve({ data: [] }),
    supabase.from("communication_logs").select("id", { count: "exact", head: true }).eq("organisation_id", org.id).eq("sandbox", true),
  ]);
  const logRows = (logs.data ?? []) as unknown as { id: string; channel: string; provider: string; sandbox: boolean; to_address: string; subject: string | null; status: string; error: string | null; created_at: string; invoice_id: string | null; customers: { id: string; name: string } | null; invoices: { invoice_number: string } | null }[];
  const href = (t: string) => (t === "log" ? "/communications" : `/communications?tab=${t}`);

  return (
    <>
      <PageHeader title="Communications" description="Every message Capflow has sent or attempted, the templates behind them, and who has opted out."
        actions={tab === "templates" && canEdit ? <TemplateDialog trigger={<Button><Plus />New template</Button>} /> : null} />
      {(sandboxCount.count ?? 0) > 0 ? (
        <div className="mb-4"><Notice tone="warn" title="Some messages were recorded in sandbox mode and were not delivered"
          action={<Link href="/integrations" className="text-sm font-semibold underline">Configure email</Link>}>
          No live email provider is configured, so those reminders were logged here but never reached a customer.</Notice></div>
      ) : null}
      <div className="mb-4"><Tabs active={tab} tabs={[
        { key: "log", label: "Message log", href: href("log") }, { key: "templates", label: "Templates", href: href("templates") }, { key: "optouts", label: "Opt-outs", href: href("optouts") },
      ]} /></div>

      {tab === "log" ? (
        <Card>
          {logRows.length === 0 ? (
            <EmptyState icon={MessagesSquare} title="No messages yet" description="Once reminders are approved and sent, each one is logged here with its delivery status from the provider." />
          ) : (
            <>
              <Table>
                <thead><tr><Th>Sent</Th><Th>Customer</Th><Th>Invoice</Th><Th>Subject</Th><Th>Channel</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {logRows.map((l) => (
                    <Tr key={l.id}>
                      <Td className="whitespace-nowrap text-muted">{formatDateTime(l.created_at, org.timezone)}</Td>
                      <Td>{l.customers ? <Link href={`/customers/${l.customers.id}`} className="font-medium hover:text-brand-700">{l.customers.name}</Link> : "—"}<p className="text-xs text-muted">{l.to_address}</p></Td>
                      <Td>{l.invoice_id ? <Link href={`/invoices/${l.invoice_id}`} className="hover:text-brand-700">{l.invoices?.invoice_number}</Link> : "—"}</Td>
                      <Td className="max-w-xs truncate">{l.subject ?? "—"}</Td>
                      <Td className="text-muted">{titleCase(l.channel)}<span className="text-xs text-faint"> · {l.provider}</span></Td>
                      <Td><StatusBadge status={l.status} />{l.error ? <p className="mt-1 max-w-52 truncate text-xs text-danger-700" title={l.error}>{l.error}</p> : null}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <Pagination page={page} pageSize={PAGE_SIZE} total={logs.count ?? 0} hrefFor={(p) => `/communications?page=${p}`} />
            </>
          )}
        </Card>
      ) : null}

      {tab === "templates" ? (
        <div className="grid gap-4 md:grid-cols-2">
          {((templates.data ?? []) as Template[]).map((t) => (
            <Card key={t.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div><h2 className="text-[15px] font-semibold">{t.name}</h2><div className="mt-1.5 flex gap-1.5"><Badge tone="blue">{titleCase(t.tone)}</Badge><Badge>{titleCase(t.channel)}</Badge>{t.is_default ? <Badge tone="green">Default</Badge> : null}</div></div>
                {canEdit ? (
                  <div className="flex gap-1">
                    <TemplateDialog template={t} trigger={<Button size="icon" variant="ghost" aria-label={`Edit ${t.name}`}><Pencil /></Button>} />
                    <ActionButton size="icon" variant="ghost" aria-label={`Delete ${t.name}`} action={deleteTemplate.bind(null, t.id)}
                      confirm={{ title: `Delete "${t.name}"?`, description: "Reminders already drafted keep their text. This cannot be undone.", confirmLabel: "Delete template", danger: true }}><Trash2 /></ActionButton>
                  </div>
                ) : null}
              </div>
              <p className="mt-4 text-sm font-medium">{t.subject}</p>
              <p className="mt-2 line-clamp-6 text-[13px] leading-relaxed whitespace-pre-wrap text-muted">{t.body}</p>
            </Card>
          ))}
        </div>
      ) : null}

      {tab === "optouts" ? (
        <Card>
          {(optouts.data ?? []).length === 0 ? (
            <EmptyState icon={MailX} title="Nobody has opted out" description="Every reminder email includes an unsubscribe link. Customers who use it are listed here and are never emailed again unless you record new consent." />
          ) : (
            <Table>
              <thead><tr><Th>Customer</Th><Th>Email</Th><Th>Opted out</Th></tr></thead>
              <tbody>
                {(optouts.data ?? []).map((c) => (
                  <Tr key={c.id}><Td><Link href={`/customers/${c.id}`} className="font-medium hover:text-brand-700">{c.name}</Link></Td><Td className="text-muted">{c.email}</Td><Td className="text-muted">{formatDateTime(c.consent_updated_at, org.timezone)}</Td></Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      ) : null}
    </>
  );
}
