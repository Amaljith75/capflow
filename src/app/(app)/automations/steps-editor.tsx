"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowUpFromLine, Loader2, Mail, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import type { RuleStep, Template } from "@/lib/types";
import { saveSteps, type StepInput } from "./actions";

type Draft = Omit<StepInput, "offset_days"> & { offset_days: string; key: string };

function timing(offset: number): string {
  if (Number.isNaN(offset)) return "";
  if (offset === 0) return "On the due date";
  return `${Math.abs(offset)} day${Math.abs(offset) === 1 ? "" : "s"} ${offset < 0 ? "before due" : "overdue"}`;
}

export function StepsEditor({ ruleId, steps, templates, canEdit }: { ruleId: string; steps: RuleStep[]; templates: Template[]; canEdit: boolean }) {
  const router = useRouter();
  const [drafts, setDrafts] = React.useState<Draft[]>(() =>
    steps.map((s) => ({ id: s.id, key: s.id, offset_days: String(s.offset_days), stage: s.stage, action: s.action, channel: s.channel, tone: s.tone, template_id: s.template_id })));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const update = (key: string, patch: Partial<Draft>) => setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const add = () => {
    const last = Math.max(0, ...drafts.map((d) => Number(d.offset_days) || 0));
    setDrafts((list) => [...list, { id: null, key: crypto.randomUUID(), offset_days: String(last + 7), stage: "Follow-up", action: "send", channel: "email", tone: "firm", template_id: templates.find((t) => t.tone === "firm")?.id ?? templates[0]?.id ?? null }]);
  };

  const save = async () => {
    setError(null);
    if (drafts.some((d) => !/^-?\d+$/.test(d.offset_days.trim()))) {
      setError("Each step needs a whole number of days.");
      return;
    }
    setSaving(true);
    const result = await saveSteps(ruleId, drafts.map(({ key: _key, offset_days, ...rest }) => ({ ...rest, offset_days: Number(offset_days) })));
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(result.message ?? "Saved.");
    router.refresh();
  };

  const sorted = [...drafts].sort((a, b) => (Number(a.offset_days) || 0) - (Number(b.offset_days) || 0));

  return (
    <div>
      {error ? <p role="alert" className="mb-3 rounded-xl border border-danger-100 bg-danger-50 px-3 py-2.5 text-sm text-danger-700">{error}</p> : null}
      <ol className="flex flex-col gap-3">
        {sorted.map((d) => (
          <li key={d.key} className="rounded-xl border border-line p-4">
            <div className="grid gap-3 md:grid-cols-[7rem_minmax(0,1fr)_9rem_9rem_minmax(0,1fr)_2.5rem] md:items-end">
              <label className="flex flex-col gap-1 text-xs text-muted">Days from due
                <Input aria-label="Days from due date" inputMode="numeric" disabled={!canEdit} value={d.offset_days} onChange={(e) => update(d.key, { offset_days: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">Step name
                <Input disabled={!canEdit} value={d.stage} onChange={(e) => update(d.key, { stage: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">Action
                <Select disabled={!canEdit} value={d.action} onChange={(e) => update(d.key, { action: e.target.value as Draft["action"] })}>
                  <option value="send">Send message</option><option value="escalate">Escalate to manager</option>
                </Select>
              </label>
              {d.action === "send" ? (
                <>
                  <label className="flex flex-col gap-1 text-xs text-muted">Tone
                    <Select disabled={!canEdit} value={d.tone} onChange={(e) => update(d.key, { tone: e.target.value as Draft["tone"] })}>
                      <option value="friendly">Friendly</option><option value="professional">Professional</option><option value="firm">Firm</option><option value="final">Final reminder</option>
                    </Select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted">Template
                    <Select disabled={!canEdit} value={d.template_id ?? ""} onChange={(e) => update(d.key, { template_id: e.target.value || null })}>
                      <option value="">Choose…</option>
                      {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </Select>
                  </label>
                </>
              ) : (
                <p className="text-[13px] text-muted md:col-span-2 md:pb-2.5">No message is sent to the customer. Finance managers are notified and the invoice waits for a person.</p>
              )}
              {canEdit ? <Button type="button" variant="ghost" size="icon" className="size-10" disabled={drafts.length === 1} onClick={() => setDrafts((list) => list.filter((x) => x.key !== d.key))} aria-label={`Remove step ${d.stage}`}><Trash2 /></Button> : null}
            </div>
            <p className="mt-2.5 flex items-center gap-1.5 text-xs text-faint">
              {d.action === "send" ? <Mail className="size-3.5" /> : <ArrowUpFromLine className="size-3.5" />}
              {timing(Number(d.offset_days))}{d.action === "send" ? " · email" : ""}
            </p>
          </li>
        ))}
      </ol>
      {canEdit ? (
        <div className="mt-4 flex flex-wrap justify-between gap-2">
          <Button type="button" variant="secondary" onClick={add} disabled={drafts.length >= 20}><Plus />Add step</Button>
          <Button type="button" onClick={save} disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : null}Save sequence</Button>
        </div>
      ) : null}
    </div>
  );
}
