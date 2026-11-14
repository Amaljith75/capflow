import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, FormField, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { Notice, PageHeader } from "@/components/ui/misc";
import { getEntitlements, requireContext } from "@/lib/auth/context";
import { can } from "@/lib/permissions";
import type { AutomationRule, RuleStep, Template } from "@/lib/types";
import { saveRule } from "./actions";
import { StepsEditor } from "./steps-editor";

export const metadata: Metadata = { title: "Automations" };
const DAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]] as const;

export default async function AutomationsPage() {
  const { supabase, org, role } = await requireContext();
  const entitlements = await getEntitlements();
  const canEdit = can(role, "finance_manager");
  const [{ data: ruleRow }, { data: templates }, { data: ai }] = await Promise.all([
    supabase.from("automation_rules").select("*").eq("organisation_id", org.id).eq("is_default", true).maybeSingle(),
    supabase.from("communication_templates").select("*").eq("organisation_id", org.id).eq("channel", "email").order("created_at"),
    supabase.from("integration_configs").select("enabled").eq("organisation_id", org.id).eq("kind", "ai").maybeSingle(),
  ]);
  if (!ruleRow) {
    return (<><PageHeader title="Automations" /><Notice tone="danger">This organisation has no recovery sequence. Contact support.</Notice></>);
  }
  const rule = ruleRow as AutomationRule;
  const { data: steps } = await supabase.from("automation_rule_steps").select("*").eq("rule_id", rule.id).order("offset_days");

  return (
    <>
      <PageHeader title="Automations" description="The reminder sequence every sent invoice follows, and the rules that keep it polite." />
      {!rule.is_active ? <div className="mb-4"><Notice tone="warn" title="Automation is switched off">No new reminders are being planned. Invoices are still tracked.</Notice></div> : null}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Reminder sequence" description="Each step runs once per invoice, relative to its due date. Steps never run for paid, disputed, paused or promised invoices." action={<Badge tone={rule.is_active ? "green" : "neutral"} dot>{rule.is_active ? "Active" : "Off"}</Badge>} />
          <CardBody>
            <StepsEditor ruleId={rule.id} steps={(steps ?? []) as RuleStep[]} templates={(templates ?? []) as Template[]} canEdit={canEdit} />
            <p className="mt-4 text-xs text-muted">Message wording lives in <Link href="/communications?tab=templates" className="font-medium text-brand-700 hover:underline">Communications → Templates</Link>.</p>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Sending rules" />
          <CardBody>
            <ActionForm action={saveRule} className="flex flex-col gap-4">
              <input type="hidden" name="id" value={rule.id} />
              <FormField name="name" label="Sequence name"><Input id="name" name="name" defaultValue={rule.name} disabled={!canEdit} /></FormField>
              <FormField name="approval_mode" label="Approval" hint="Manual: every message waits in Recovery for a finance manager. Automatic: messages are sent at their scheduled time.">
                <Select id="approval_mode" name="approval_mode" defaultValue={rule.approval_mode} disabled={!canEdit}>
                  <option value="manual">Manual approval (recommended to start)</option><option value="auto">Automatic sending</option>
                </Select>
              </FormField>
              <div className="grid grid-cols-2 gap-4">
                <FormField name="working_hours_start" label="Send from"><Input id="working_hours_start" name="working_hours_start" type="time" defaultValue={rule.working_hours_start.slice(0, 5)} disabled={!canEdit} /></FormField>
                <FormField name="working_hours_end" label="Send until"><Input id="working_hours_end" name="working_hours_end" type="time" defaultValue={rule.working_hours_end.slice(0, 5)} disabled={!canEdit} /></FormField>
              </div>
              <fieldset>
                <legend className="mb-1.5 text-[13px] font-medium text-ink-soft">Working days</legend>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS.map(([value, label]) => (
                    <label key={value} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[13px] has-checked:border-brand-600 has-checked:bg-brand-50">
                      <Checkbox name="working_days" value={value} defaultChecked={rule.working_days.includes(value)} disabled={!canEdit} />{label}
                    </label>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-muted">Times are in {org.timezone.replace(/_/g, " ")}. Messages due outside these hours wait for the next window.</p>
              </fieldset>
              <div className="grid grid-cols-2 gap-4">
                <FormField name="max_attempts" label="Maximum reminders per invoice"><Input id="max_attempts" name="max_attempts" type="number" min={1} max={30} defaultValue={rule.max_attempts} disabled={!canEdit} /></FormField>
                <FormField name="min_hours_between" label="Minimum hours between reminders"><Input id="min_hours_between" name="min_hours_between" type="number" min={1} max={720} defaultValue={rule.min_hours_between} disabled={!canEdit} /></FormField>
              </div>
              <label className="flex items-start gap-2.5 text-sm">
                <Checkbox name="use_ai" defaultChecked={rule.use_ai} disabled={!canEdit || !entitlements.limits.ai_reminders} className="mt-0.5" />
                <span>Personalise each message with AI
                  <span className="block text-xs text-muted">
                    {!entitlements.limits.ai_reminders ? "Included from the Growth plan." : ai?.enabled ? "Drafts are validated against safety rules; if the AI is unavailable the template is used." : "Requires the AI integration to be enabled. Until then templates are used."}
                  </span>
                </span>
              </label>
              <label className="flex items-center gap-2.5 text-sm"><Checkbox name="is_active" defaultChecked={rule.is_active} disabled={!canEdit} />Automation is on</label>
              {canEdit ? <div><SubmitButton>Save rules</SubmitButton></div> : <p className="text-xs text-muted">Only finance managers and above can change automation.</p>}
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
