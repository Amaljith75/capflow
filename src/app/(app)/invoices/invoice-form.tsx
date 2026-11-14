"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { addDays } from "@/lib/dates";
import { CURRENCIES, formatMoney, fromMinor, invoiceTotals, lineTotals } from "@/lib/money";
import { invoiceSchema, type InvoiceInput } from "@/lib/validation/schemas";
import { saveInvoice } from "./actions";

interface CustomerOption {
  id: string;
  name: string;
  currency: string;
  payment_terms_days: number;
}

function safeLine(item: InvoiceInput["items"][number]): string {
  try {
    return fromMinor(lineTotals({ quantity: item.quantity || "0", unitPrice: item.unit_price || "0", taxRate: item.tax_rate, taxAmount: item.tax_amount }).total);
  } catch {
    return "0.00";
  }
}

export function InvoiceForm({ invoiceId, customers, defaults, canSend }: {
  invoiceId: string | null;
  customers: CustomerOption[];
  defaults: InvoiceInput;
  /** false when editing an invoice that is no longer a draft */
  canSend: boolean;
}) {
  const router = useRouter();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState<"draft" | "send" | null>(null);
  const { register, control, handleSubmit, watch, setValue, getValues, formState: { errors } } = useForm<InvoiceInput>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: defaults,
  });
  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const items = watch("items");
  const currency = watch("currency");

  let totals = { subtotal: "0.00", tax: "0.00", total: "0.00" };
  try {
    const t = invoiceTotals(items.map((i) => ({ quantity: i.quantity || "0", unitPrice: i.unit_price || "0", taxRate: i.tax_rate, taxAmount: i.tax_amount })));
    totals = { subtotal: fromMinor(t.subtotal), tax: fromMinor(t.tax), total: fromMinor(t.total) };
  } catch {
    // a field is mid-edit and not yet a valid number; keep the last valid preview at zero
  }

  const onCustomerChange = (id: string) => {
    const customer = customers.find((c) => c.id === id);
    if (!customer || invoiceId) return;
    setValue("currency", customer.currency);
    const issue = getValues("issue_date");
    if (issue) setValue("due_date", addDays(issue, customer.payment_terms_days));
  };

  const submit = (send: boolean) =>
    handleSubmit(async (values) => {
      setServerError(null);
      setSubmitting(send ? "send" : "draft");
      const result = await saveInvoice(invoiceId, values, send);
      setSubmitting(null);
      if (!result.ok) {
        setServerError(result.error);
        return;
      }
      toast.success(result.message ?? "Saved.");
      router.push(`/invoices/${result.data?.id ?? invoiceId}`);
      router.refresh();
    });

  return (
    <form onSubmit={submit(false)} className="grid gap-4 lg:grid-cols-3" noValidate>
      <div className="flex flex-col gap-4 lg:col-span-2">
        {serverError ? (
          <p role="alert" className="rounded-xl border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-700">{serverError}</p>
        ) : null}
        <Card>
          <CardHeader title="Invoice details" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Customer" htmlFor="customer_id" error={errors.customer_id ? "Choose a customer." : undefined} className="sm:col-span-2">
              <Select id="customer_id" {...register("customer_id", { onChange: (e) => onCustomerChange(e.target.value) })}>
                <option value="">Select a customer…</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Invoice number" htmlFor="invoice_number" error={errors.invoice_number?.message}>
              <Input id="invoice_number" {...register("invoice_number")} placeholder="INV-0001" />
            </Field>
            <Field label="Currency" htmlFor="currency" error={errors.currency?.message}>
              <Select id="currency" {...register("currency")}>
                {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </Select>
            </Field>
            <Field label="Issue date" htmlFor="issue_date" error={errors.issue_date?.message}>
              <Input id="issue_date" type="date" {...register("issue_date")} />
            </Field>
            <Field label="Due date" htmlFor="due_date" error={errors.due_date?.message}>
              <Input id="due_date" type="date" {...register("due_date")} />
            </Field>
            <Field label="Payment reference" htmlFor="payment_reference" hint="Shown to the customer so they can quote it when paying." error={errors.payment_reference?.message}>
              <Input id="payment_reference" {...register("payment_reference")} />
            </Field>
            <Field label="Notes" htmlFor="notes" className="sm:col-span-2" error={errors.notes?.message}>
              <Textarea id="notes" {...register("notes")} className="min-h-16" />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Line items"
            description="Tax is calculated per line and rounded to 2 decimal places."
            action={<Button type="button" variant="secondary" size="sm" onClick={() => append({ description: "", quantity: "1", unit_price: "", tax_rate: "" })}><Plus />Add line</Button>}
          />
          <CardBody className="flex flex-col gap-3">
            <div className="hidden grid-cols-[minmax(0,1fr)_5rem_7rem_5rem_7rem_2.25rem] gap-2 text-xs text-muted sm:grid">
              <span>Description</span><span>Qty</span><span>Unit price</span><span>Tax %</span><span className="text-right">Line total</span><span />
            </div>
            {fields.map((field, index) => {
              const itemErrors = errors.items?.[index];
              const message = itemErrors?.description?.message ?? itemErrors?.quantity?.message ?? itemErrors?.unit_price?.message ?? itemErrors?.tax_rate?.message;
              return (
                <div key={field.id}>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_7rem_5rem_7rem_2.25rem]">
                    <Input className="col-span-2 sm:col-span-1" aria-label={`Line ${index + 1} description`} placeholder="Description" aria-invalid={!!itemErrors?.description} {...register(`items.${index}.description`)} />
                    <Input aria-label={`Line ${index + 1} quantity`} inputMode="decimal" placeholder="Qty" aria-invalid={!!itemErrors?.quantity} {...register(`items.${index}.quantity`)} />
                    <Input aria-label={`Line ${index + 1} unit price`} inputMode="decimal" placeholder="0.00" aria-invalid={!!itemErrors?.unit_price} {...register(`items.${index}.unit_price`)} />
                    <Input aria-label={`Line ${index + 1} tax rate`} inputMode="decimal" placeholder="0" aria-invalid={!!itemErrors?.tax_rate} {...register(`items.${index}.tax_rate`)} />
                    <p className="flex h-10 items-center justify-end text-sm font-medium tabular">{formatMoney(safeLine(items[index] ?? field), currency)}</p>
                    <Button type="button" variant="ghost" size="icon" className="size-10" disabled={fields.length === 1} onClick={() => remove(index)} aria-label={`Remove line ${index + 1}`}><Trash2 /></Button>
                  </div>
                  {items[index]?.tax_amount && !items[index]?.tax_rate ? (
                    <p className="mt-1 text-xs text-muted">Fixed tax of {formatMoney(items[index].tax_amount, currency)} from import. Enter a rate to replace it.</p>
                  ) : null}
                  {message ? <p role="alert" className="mt-1 text-xs text-danger-700">{message}</p> : null}
                </div>
              );
            })}
            {errors.items?.root?.message || errors.items?.message ? <p role="alert" className="text-xs text-danger-700">{errors.items?.root?.message ?? errors.items?.message}</p> : null}
          </CardBody>
        </Card>
      </div>

      <div>
        <Card className="lg:sticky lg:top-24">
          <CardHeader title="Summary" />
          <CardBody>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular">{formatMoney(totals.subtotal, currency)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Tax</dt><dd className="tabular">{formatMoney(totals.tax, currency)}</dd></div>
              <div className="flex justify-between border-t border-line pt-3 text-base font-semibold"><dt>Total</dt><dd className="tabular">{formatMoney(totals.total, currency)}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-muted">Preview only. The saved totals are calculated by the database from the line items.</p>
            <div className="mt-5 flex flex-col gap-2">
              {canSend ? (
                <Button type="button" onClick={submit(true)} disabled={submitting !== null}>
                  {submitting === "send" ? <Loader2 className="animate-spin" /> : null}Save and mark as sent
                </Button>
              ) : null}
              <Button type="submit" variant={canSend ? "secondary" : "primary"} disabled={submitting !== null}>
                {submitting === "draft" ? <Loader2 className="animate-spin" /> : null}{invoiceId ? "Save changes" : "Save as draft"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
            </div>
            {canSend ? <p className="mt-3 text-xs text-muted">Marking as sent starts the recovery sequence. Capflow does not email the invoice itself.</p> : null}
          </CardBody>
        </Card>
      </div>
    </form>
  );
}
