"use client";

import * as React from "react";
import { FormDialog, FormField } from "@/components/ui/action-form";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { saveIntegration } from "./actions";

export interface FieldSpec {
  name: string;
  label: string;
  hint?: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
}

export function IntegrationDialog({ kind, title, description, fields, settings, enabled, hasSecret, secretLabel, trigger }: {
  kind: string; title: string; description: string; fields: FieldSpec[]; settings: Record<string, string>;
  enabled: boolean; hasSecret: boolean; secretLabel?: string; trigger: React.ReactNode;
}) {
  return (
    <FormDialog trigger={trigger} title={title} description={description} action={saveIntegration} submitLabel="Save" className="max-w-xl">
      <input type="hidden" name="kind" value={kind} />
      {fields.map((f) => (
        <FormField key={f.name} name={f.name} label={f.label} hint={f.hint}>
          {f.options ? (
            <Select id={f.name} name={f.name} defaultValue={settings[f.name] ?? f.options[0]?.value}>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          ) : (
            <Input id={f.name} name={f.name} defaultValue={settings[f.name] ?? ""} placeholder={f.placeholder} />
          )}
        </FormField>
      ))}
      {secretLabel ? (
        <FormField name="secret" label={secretLabel} hint={hasSecret ? "A key is stored (encrypted). Leave blank to keep it." : "Stored encrypted. It is never shown again."}>
          <Input id="secret" name="secret" type="password" autoComplete="off" placeholder={hasSecret ? "••••••••••••" : ""} />
        </FormField>
      ) : null}
      <label className="flex items-center gap-2.5 text-sm"><Checkbox name="enabled" defaultChecked={enabled} />Enabled</label>
    </FormDialog>
  );
}
