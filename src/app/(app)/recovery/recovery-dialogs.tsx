"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
import { ActionButton, FormDialog, FormField } from "@/components/ui/action-form";
import { Input, Select, Textarea } from "@/components/ui/input";
import type { Reminder } from "@/lib/types";
import { editReminder, requestAiDraft } from "./actions";

export function EditReminderDialog({ reminder, trigger }: { reminder: Reminder; trigger: React.ReactNode }) {
  return (
    <FormDialog trigger={trigger} title="Edit reminder" submitLabel="Save draft" action={editReminder} className="max-w-2xl"
      description="Changes apply to this message only. Nothing is sent until it is approved.">
      <input type="hidden" name="id" value={reminder.id} />
      <FormField name="tone" label="Tone">
        <Select id="tone" name="tone" defaultValue={reminder.tone}>
          <option value="friendly">Friendly</option><option value="professional">Professional</option><option value="firm">Firm</option><option value="final">Final reminder</option>
        </Select>
      </FormField>
      <FormField name="subject" label="Subject"><Input id="subject" name="subject" required defaultValue={reminder.subject ?? ""} /></FormField>
      <FormField name="body" label="Message"><Textarea id="body" name="body" required defaultValue={reminder.body} className="min-h-64 font-mono text-[13px]" /></FormField>
    </FormDialog>
  );
}

export function AiDraftButton({ reminderId, tone, disabledReason }: { reminderId: string; tone: string; disabledReason?: string }) {
  return (
    <ActionButton size="sm" variant="secondary" action={requestAiDraft.bind(null, reminderId, tone)} disabled={Boolean(disabledReason)} title={disabledReason}>
      <Sparkles />Personalise with AI
    </ActionButton>
  );
}
