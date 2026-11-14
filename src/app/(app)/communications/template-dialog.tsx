"use client";

import * as React from "react";
import { FormDialog, FormField } from "@/components/ui/action-form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { TEMPLATE_VARIABLES } from "@/lib/templates";
import type { Template } from "@/lib/types";
import { saveTemplate } from "../automations/actions";

export function TemplateDialog({ template, trigger }: { template?: Template; trigger: React.ReactNode }) {
  return (
    <FormDialog trigger={trigger} title={template ? "Edit template" : "New template"} submitLabel={template ? "Save template" : "Create template"} action={saveTemplate} className="max-w-2xl"
      description="Templates are the wording used for automated and manual reminders.">
      {template ? <input type="hidden" name="id" value={template.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="name" label="Name"><Input id="name" name="name" required defaultValue={template?.name} /></FormField>
        <FormField name="tone" label="Tone">
          <Select id="tone" name="tone" defaultValue={template?.tone ?? "professional"}>
            <option value="friendly">Friendly</option><option value="professional">Professional</option><option value="firm">Firm</option><option value="final">Final reminder</option>
          </Select>
        </FormField>
      </div>
      <FormField name="subject" label="Subject"><Input id="subject" name="subject" required defaultValue={template?.subject ?? ""} /></FormField>
      <FormField name="body" label="Message">
        <Textarea id="body" name="body" required defaultValue={template?.body} className="min-h-56 font-mono text-[13px]" />
      </FormField>
      <p className="text-xs leading-relaxed text-muted">
        Variables: {TEMPLATE_VARIABLES.map((v) => <code key={v} className="mr-1.5 rounded bg-subtle px-1 font-mono">{`{{${v}}}`}</code>)}
        <br />Keep the wording factual and courteous. Do not threaten legal action or consequences you will not carry out.
      </p>
    </FormDialog>
  );
}
