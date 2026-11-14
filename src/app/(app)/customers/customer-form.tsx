"use client";

import * as React from "react";
import { FormDialog, FormField } from "@/components/ui/action-form";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { CURRENCIES } from "@/lib/money";
import type { Customer } from "@/lib/types";
import { saveCustomer } from "./actions";

export function CustomerDialog({ trigger, customer, defaultCurrency }: {
  trigger: React.ReactNode; customer?: Customer; defaultCurrency: string;
}) {
  return (
    <FormDialog
      trigger={trigger}
      title={customer ? "Edit customer" : "Add customer"}
      description={customer ? undefined : "Customers are the businesses you invoice."}
      action={saveCustomer}
      submitLabel={customer ? "Save changes" : "Add customer"}
      className="max-w-xl"
    >
      {customer ? <input type="hidden" name="id" value={customer.id} /> : null}
      <FormField name="name" label="Customer / business name">
        <Input id="name" name="name" required defaultValue={customer?.name} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="email" label="Billing email" hint="Reminders are sent here.">
          <Input id="email" name="email" type="email" defaultValue={customer?.email ?? ""} />
        </FormField>
        <FormField name="phone" label="Phone" hint="Include the country code.">
          <Input id="phone" name="phone" defaultValue={customer?.phone ?? ""} placeholder="+91 98765 43210" />
        </FormField>
        <FormField name="currency" label="Currency">
          <Select id="currency" name="currency" defaultValue={customer?.currency ?? defaultCurrency}>
            {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </Select>
        </FormField>
        <FormField name="payment_terms_days" label="Payment terms (days)">
          <Input id="payment_terms_days" name="payment_terms_days" type="number" min={0} max={365} defaultValue={customer?.payment_terms_days ?? 30} />
        </FormField>
      </div>
      <FormField name="tax_id" label="Tax ID (GSTIN / VAT / EIN)">
        <Input id="tax_id" name="tax_id" defaultValue={customer?.tax_id ?? ""} />
      </FormField>
      <FormField name="billing_address" label="Billing address">
        <Textarea id="billing_address" name="billing_address" defaultValue={customer?.billing_address ?? ""} className="min-h-16" />
      </FormField>
      <FormField name="notes" label="Internal notes" hint="Never shown to the customer.">
        <Textarea id="notes" name="notes" defaultValue={customer?.notes ?? ""} className="min-h-16" />
      </FormField>
      {customer ? (
        <fieldset className="rounded-xl border border-line p-4">
          <legend className="px-1 text-[13px] font-medium text-ink-soft">Consent</legend>
          <div className="flex flex-col gap-2.5 text-sm">
            <label className="flex items-center gap-2.5"><Checkbox name="email_opt_out" defaultChecked={customer.email_opt_out} />Opted out of email reminders</label>
            <label className="flex items-center gap-2.5"><Checkbox name="whatsapp_opt_in" defaultChecked={customer.whatsapp_opt_in} />Has opted in to WhatsApp messages</label>
            <label className="flex items-center gap-2.5"><Checkbox name="sms_opt_in" defaultChecked={customer.sms_opt_in} />Has opted in to SMS messages</label>
          </div>
        </fieldset>
      ) : null}
    </FormDialog>
  );
}
