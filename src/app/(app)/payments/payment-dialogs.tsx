"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { FormDialog, FormField } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { formatDate } from "@/lib/dates";
import { formatMoney, fromMinor, isValidAmount, toMinor } from "@/lib/money";
import { PAYMENT_METHODS } from "@/lib/validation/schemas";
import { loadOpenInvoices, recordPayment, voidPayment, type DuplicateWarning, type OpenInvoice } from "./actions";

interface CustomerOption {
  id: string;
  name: string;
  currency: string;
}

function minorOrZero(value: string): bigint {
  return value && isValidAmount(value) && !value.startsWith("-") ? toMinor(value) : 0n;
}

/** Spreads an amount across invoices oldest-due first, never exceeding each balance. */
function autoAllocate(amount: bigint, invoices: OpenInvoice[], preferred?: string): Record<string, string> {
  const result: Record<string, string> = {};
  let remaining = amount;
  const ordered = preferred ? [...invoices].sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred)) : invoices;
  for (const invoice of ordered) {
    if (remaining <= 0n) break;
    const outstanding = toMinor(invoice.amount_outstanding);
    const applied = remaining < outstanding ? remaining : outstanding;
    result[invoice.id] = fromMinor(applied);
    remaining -= applied;
  }
  return result;
}

export function RecordPaymentDialog({ customers, today, initial, trigger, defaultOpen }: {
  customers: CustomerOption[];
  today: string;
  initial?: { customerId: string; invoiceId: string };
  trigger: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(defaultOpen ?? false);
  const [customerId, setCustomerId] = React.useState(initial?.customerId ?? "");
  const [invoices, setInvoices] = React.useState<OpenInvoice[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [currency, setCurrency] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [date, setDate] = React.useState(today);
  const [method, setMethod] = React.useState("bank_transfer");
  const [reference, setReference] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [allocations, setAllocations] = React.useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = React.useState<DuplicateWarning[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  // Stable for the life of one payment entry; a retry after a network error cannot double-record.
  const [key, setKey] = React.useState(() => crypto.randomUUID());

  const selectCustomer = React.useCallback(async (id: string) => {
    setCustomerId(id);
    setAllocations({});
    setInvoices([]);
    setDuplicates(null);
    if (!id) return;
    setLoading(true);
    try {
      const list = await loadOpenInvoices(id);
      setInvoices(list);
      setCurrency((current) => (list.some((i) => i.currency === current) ? current : list[0]?.currency ?? customers.find((c) => c.id === id)?.currency ?? ""));
    } finally {
      setLoading(false);
    }
  }, [customers]);

  React.useEffect(() => {
    if (open && initial?.customerId) void selectCustomer(initial.customerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const eligible = invoices.filter((i) => i.currency === currency);
  const amountMinor = minorOrZero(amount);
  const allocatedMinor = eligible.reduce((sum, i) => sum + minorOrZero(allocations[i.id] ?? ""), 0n);
  const remaining = amountMinor - allocatedMinor;

  const changeAmount = (value: string) => {
    setAmount(value);
    setDuplicates(null);
    setAllocations(autoAllocate(minorOrZero(value), eligible, initial?.invoiceId));
  };

  const submit = async (confirmDuplicate: boolean) => {
    setError(null);
    setSubmitting(true);
    const result = await recordPayment({
      customer_id: customerId, amount, currency, payment_date: date, method: method as "bank_transfer", reference, notes,
      idempotency_key: key, confirm_duplicate: confirmDuplicate,
      allocations: eligible.filter((i) => minorOrZero(allocations[i.id] ?? "") > 0n).map((i) => ({ invoice_id: i.id, amount: allocations[i.id] })),
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.data?.duplicates) {
      setDuplicates(result.data.duplicates);
      return;
    }
    toast.success(result.message ?? "Payment recorded.");
    setOpen(false);
    setAmount(""); setReference(""); setNotes(""); setAllocations({}); setDuplicates(null); setKey(crypto.randomUUID());
    router.replace("/payments");
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Record a payment" description="Record money you have actually received, then apply it to one or more invoices." className="max-w-2xl">
        <form onSubmit={(e) => { e.preventDefault(); void submit(false); }} className="flex flex-col gap-4">
          {error ? <p role="alert" className="rounded-xl border border-danger-100 bg-danger-50 px-3 py-2.5 text-sm text-danger-700">{error}</p> : null}
          <Field label="Customer" htmlFor="pay-customer">
            <Select id="pay-customer" value={customerId} onChange={(e) => void selectCustomer(e.target.value)} required>
              <option value="">Select a customer…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={`Amount received${currency ? ` (${currency})` : ""}`} htmlFor="pay-amount">
              <Input id="pay-amount" inputMode="decimal" required value={amount} onChange={(e) => changeAmount(e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Payment date" htmlFor="pay-date">
              <Input id="pay-date" type="date" required max={today} value={date} onChange={(e) => { setDate(e.target.value); setDuplicates(null); }} />
            </Field>
            <Field label="Method" htmlFor="pay-method">
              <Select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)}>
                {Object.entries(PAYMENT_METHODS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reference" htmlFor="pay-reference" hint="Bank UTR, cheque number or transaction ID.">
              <Input id="pay-reference" value={reference} onChange={(e) => { setReference(e.target.value); setDuplicates(null); }} maxLength={120} />
            </Field>
            <Field label="Notes" htmlFor="pay-notes">
              <Input id="pay-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
            </Field>
          </div>

          {customerId ? (
            <div className="rounded-xl border border-line">
              <div className="flex items-center justify-between border-b border-line bg-subtle px-4 py-2.5">
                <p className="text-[13px] font-medium">Apply to invoices</p>
                {new Set(invoices.map((i) => i.currency)).size > 1 ? (
                  <Select aria-label="Payment currency" value={currency} onChange={(e) => { setCurrency(e.target.value); setAllocations({}); }} className="h-8 w-24 text-[13px]">
                    {[...new Set(invoices.map((i) => i.currency))].map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                ) : null}
              </div>
              {loading ? (
                <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted"><Loader2 className="size-4 animate-spin" />Loading open invoices…</p>
              ) : eligible.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted">This customer has no open invoices. The payment will be recorded as unallocated.</p>
              ) : (
                <ul className="max-h-56 divide-y divide-line overflow-y-auto">
                  {eligible.map((i) => (
                    <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{i.invoice_number}</p>
                        <p className="text-xs text-muted">Due {formatDate(i.due_date)}{i.days_overdue > 0 ? ` · ${i.days_overdue}d overdue` : ""} · {formatMoney(i.amount_outstanding, i.currency)} outstanding</p>
                      </div>
                      <Input aria-label={`Amount applied to ${i.invoice_number}`} inputMode="decimal" className="h-9 w-32 text-right tabular" placeholder="0.00"
                        value={allocations[i.id] ?? ""} onChange={(e) => setAllocations((a) => ({ ...a, [i.id]: e.target.value }))} />
                    </li>
                  ))}
                </ul>
              )}
              <div className={`flex justify-between border-t border-line px-4 py-2.5 text-[13px] ${remaining < 0n ? "text-danger-700" : "text-muted"}`}>
                <span>{remaining < 0n ? "Applied more than the payment amount" : "Unallocated"}</span>
                <span className="font-medium tabular">{currency ? formatMoney(fromMinor(remaining < 0n ? -remaining : remaining), currency) : "—"}</span>
              </div>
            </div>
          ) : null}

          {duplicates ? (
            <div className="rounded-xl border border-warn-100 bg-warn-50 p-4 text-sm">
              <p className="flex items-center gap-2 font-semibold text-warn-700"><TriangleAlert className="size-4" />This looks like a payment that is already recorded</p>
              <ul className="mt-2 space-y-1 text-ink-soft">
                {duplicates.map((d) => (
                  <li key={d.id} className="tabular">{formatMoney(d.amount, d.currency)} on {formatDate(d.payment_date)}{d.reference ? ` · ref ${d.reference}` : ""}</li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => setDuplicates(null)}>Go back</Button>
                <Button type="button" size="sm" variant="dark" disabled={submitting} onClick={() => void submit(true)}>It&apos;s a separate payment, record it</Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting || !customerId || amountMinor <= 0n || remaining < 0n || !currency}>
                {submitting ? <Loader2 className="animate-spin" /> : null}Record payment
              </Button>
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function VoidPaymentDialog({ paymentId, label, trigger }: { paymentId: string; label: string; trigger: React.ReactNode }) {
  return (
    <FormDialog trigger={trigger} title="Void this payment?" submitLabel="Void payment" action={voidPayment}
      description={`${label}. The payment stays in the ledger marked as voided, and the invoices it paid go back to their previous balance.`}>
      <input type="hidden" name="id" value={paymentId} />
      <FormField name="reason" label="Reason">
        <Textarea id="reason" name="reason" required maxLength={500} placeholder="e.g. Entered twice, cheque bounced" />
      </FormField>
    </FormDialog>
  );
}
