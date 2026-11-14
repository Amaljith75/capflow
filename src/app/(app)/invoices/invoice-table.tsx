"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/input";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { InvoiceRow } from "@/lib/types";
import { bulkInvoiceAction } from "./actions";

export interface SortState {
  sort: string;
  dir: "asc" | "desc";
  hrefs: Record<string, string>;
}

function SortHeader({ column, label, state, align }: { column: string; label: string; state: SortState; align?: "right" }) {
  const active = state.sort === column;
  return (
    <Th className={align === "right" ? "text-right" : ""} aria-sort={active ? (state.dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link href={state.hrefs[column]} className={`inline-flex items-center gap-1 hover:text-ink ${active ? "text-ink" : ""}`}>
        {label}
        {active ? (state.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : null}
      </Link>
    </Th>
  );
}

export function InvoiceTable({ rows, sort, canEdit, bulkEnabled }: {
  rows: InvoiceRow[]; sort: SortState; canEdit: boolean; bulkEnabled: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [pending, startTransition] = React.useTransition();
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = (action: "send" | "archive" | "pause" | "resume") =>
    startTransition(async () => {
      const result = await bulkInvoiceAction([...selected], action);
      if (result.ok) {
        toast.success(result.message ?? "Done.");
        setSelected(new Set());
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <>
      {canEdit && selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-brand-50 px-5 py-2.5 text-sm">
          <span className="mr-2 font-medium tabular">{selected.size} selected</span>
          {bulkEnabled ? (
            <>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => run("send")}>Mark drafts as sent</Button>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => run("pause")}>Pause recovery</Button>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => run("resume")}>Resume recovery</Button>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => run("archive")}>Archive</Button>
              {pending ? <Loader2 className="size-4 animate-spin text-muted" /> : null}
            </>
          ) : (
            <span className="text-muted">Bulk actions are part of the Business plan. <Link href="/billing" className="font-medium text-brand-700 underline">See plans</Link></span>
          )}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      ) : null}
      <Table>
        <thead>
          <tr>
            {canEdit ? (
              <Th className="w-10">
                <Checkbox aria-label="Select all invoices on this page" checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} />
              </Th>
            ) : null}
            <SortHeader column="invoice_number" label="Invoice" state={sort} />
            <SortHeader column="customer_name" label="Customer" state={sort} />
            <SortHeader column="issue_date" label="Issued" state={sort} />
            <SortHeader column="due_date" label="Due" state={sort} />
            <SortHeader column="days_overdue" label="Overdue" state={sort} />
            <Th>Status</Th>
            <SortHeader column="total" label="Total" state={sort} align="right" />
            <SortHeader column="amount_outstanding" label="Outstanding" state={sort} align="right" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.id} className={selected.has(r.id) ? "bg-brand-50/60" : ""}>
              {canEdit ? <Td><Checkbox aria-label={`Select invoice ${r.invoice_number}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></Td> : null}
              <Td><Link href={`/invoices/${r.id}`} className="font-medium text-ink hover:text-brand-700">{r.invoice_number}</Link></Td>
              <Td><Link href={`/customers/${r.customer_id}`} className="text-ink-soft hover:text-brand-700">{r.customer_name}</Link></Td>
              <Td className="whitespace-nowrap text-muted">{formatDate(r.issue_date)}</Td>
              <Td className="whitespace-nowrap text-muted">{formatDate(r.due_date)}</Td>
              <Td className={`whitespace-nowrap tabular ${r.days_overdue > 0 ? "font-medium text-danger-700" : "text-faint"}`}>{r.days_overdue > 0 ? `${r.days_overdue} days` : "—"}</Td>
              <Td><StatusBadge status={r.effective_status} /></Td>
              <Td className="text-right whitespace-nowrap tabular">{formatMoney(r.total, r.currency)}</Td>
              <Td className="text-right font-medium whitespace-nowrap tabular">{formatMoney(r.amount_outstanding, r.currency)}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
