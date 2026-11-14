"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Paperclip } from "lucide-react";
import { toast } from "sonner";
import { ActionForm, FormDialog, FormField, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { renderTemplate, type TemplateVars } from "@/lib/templates";
import type { Template } from "@/lib/types";
import { createManualReminder } from "../../recovery/actions";
import { attachmentUrl, createPromise, transitionInvoice, uploadAttachment } from "../actions";

export function DisputeDialog({ invoiceId, trigger }: { invoiceId: string; trigger: React.ReactNode }) {
  const action = async (_: unknown, formData: FormData) => transitionInvoice(invoiceId, "dispute", String(formData.get("reason") ?? ""));
  return (
    <FormDialog trigger={trigger} title="Mark as disputed" submitLabel="Mark as disputed" action={action}
      description="Automated reminders stop immediately and the invoice waits for a person to resolve it. Capflow never escalates a disputed invoice.">
      <FormField name="reason" label="What is the customer disputing?">
        <Textarea id="reason" name="reason" required maxLength={500} placeholder="e.g. Says 2 of 10 units were not delivered" />
      </FormField>
    </FormDialog>
  );
}

export function PromiseDialog({ invoiceId, outstanding, today, trigger }: {
  invoiceId: string; outstanding: string; today: string; trigger: React.ReactNode;
}) {
  return (
    <FormDialog trigger={trigger} title="Record a payment promise" submitLabel="Record promise" action={createPromise}
      description="Reminders pause until the promised date. If no verified payment arrives by then, the promise is marked broken and you are asked to follow up.">
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="promised_amount" label="Promised amount">
          <Input id="promised_amount" name="promised_amount" inputMode="decimal" required defaultValue={outstanding} />
        </FormField>
        <FormField name="promised_date" label="Expected payment date">
          <Input id="promised_date" name="promised_date" type="date" required min={today} />
        </FormField>
      </div>
      <FormField name="notes" label="Notes" hint="Who promised, and how (call, email…).">
        <Textarea id="notes" name="notes" className="min-h-16" maxLength={1000} />
      </FormField>
    </FormDialog>
  );
}

export function ReminderDialog({ invoiceId, templates, vars, canSendNow, trigger }: {
  invoiceId: string; templates: Template[]; vars: TemplateVars; canSendNow: boolean; trigger: React.ReactNode;
}) {
  const initial = templates.find((t) => t.tone === "professional") ?? templates[0];
  const [templateId, setTemplateId] = React.useState(initial?.id ?? "");
  const [subject, setSubject] = React.useState(initial ? renderTemplate(initial.subject ?? "", vars) : "");
  const [body, setBody] = React.useState(initial ? renderTemplate(initial.body, vars) : "");
  const [tone, setTone] = React.useState<string>(initial?.tone ?? "professional");
  // One token per dialog instance: a double submit cannot create two reminders.
  const [token] = React.useState(() => crypto.randomUUID());

  const choose = (id: string) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setSubject(renderTemplate(t.subject ?? "", vars));
    setBody(renderTemplate(t.body, vars));
    setTone(t.tone);
  };

  return (
    <FormDialog trigger={trigger} title="Send a reminder" submitLabel={canSendNow ? "Create reminder" : "Submit for approval"} action={createManualReminder}
      description="Sent by email to the customer's billing address. An unsubscribe link is added automatically." className="max-w-2xl">
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="tone" value={tone} />
      <FormField name="template" label="Start from a template">
        <Select id="template" value={templateId} onChange={(e) => choose(e.target.value)}>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.tone})</option>)}
        </Select>
      </FormField>
      <FormField name="subject" label="Subject">
        <Input id="subject" name="subject" required value={subject} onChange={(e) => setSubject(e.target.value)} />
      </FormField>
      <FormField name="body" label="Message">
        <Textarea id="body" name="body" required value={body} onChange={(e) => setBody(e.target.value)} className="min-h-56 font-mono text-[13px]" />
      </FormField>
      {canSendNow ? (
        <label className="flex items-center gap-2.5 text-sm"><Checkbox name="send_now" defaultChecked />Approve and queue for sending now</label>
      ) : (
        <p className="text-[13px] text-muted">A finance manager must approve this reminder before it is sent.</p>
      )}
    </FormDialog>
  );
}

export function AttachmentPanel({ invoiceId, name, canEdit }: { invoiceId: string; name: string | null; canEdit: boolean }) {
  const router = useRouter();
  const [opening, setOpening] = React.useState(false);
  const open = async () => {
    setOpening(true);
    const result = await attachmentUrl(invoiceId);
    setOpening(false);
    if (result.ok && result.data) window.open(result.data.url, "_blank", "noopener");
    else if (!result.ok) toast.error(result.error);
  };
  return (
    <div className="flex flex-col gap-3">
      {name ? (
        <button type="button" onClick={open} disabled={opening} className="flex items-center gap-2 rounded-xl border border-line bg-subtle px-3 py-2.5 text-left text-sm hover:border-line-strong">
          <Paperclip className="size-4 shrink-0 text-muted" /><span className="truncate font-medium">{name}</span>
          <span className="ml-auto text-xs text-brand-700">{opening ? "Opening…" : "Open"}</span>
        </button>
      ) : (
        <p className="text-sm text-muted">No file attached.</p>
      )}
      {canEdit ? (
        <ActionForm action={uploadAttachment} onSuccess={() => router.refresh()} resetOnSuccess className="flex flex-col gap-2">
          <input type="hidden" name="invoice_id" value={invoiceId} />
          <input type="file" name="file" required accept="application/pdf,image/png,image/jpeg" aria-label="Invoice file"
            className="text-[13px] file:mr-3 file:rounded-lg file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-[13px] file:font-medium" />
          <div><SubmitButton size="sm" variant="secondary">{name ? "Replace file" : "Upload"}</SubmitButton></div>
          <p className="text-xs text-muted">PDF, PNG or JPEG, up to 10 MB. Stored privately.</p>
        </ActionForm>
      ) : null}
    </div>
  );
}

