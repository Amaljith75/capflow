import type { Metadata } from "next";
import Link from "next/link";
import { Download, KeyRound } from "lucide-react";
import { ActionForm, FormField, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/misc";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { requireContext } from "@/lib/auth/context";
import { formatDateTime, TIMEZONES } from "@/lib/dates";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { deleteOrganisation, saveOrganisation, saveProfile } from "./actions";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { supabase, org, role, user } = await requireContext();
  const isAdmin = can(role, "admin");
  const { data: audit } = isAdmin
    ? await supabase.from("audit_logs").select("id, action, actor_type, entity_type, created_at").eq("organisation_id", org.id).order("created_at", { ascending: false }).limit(25)
    : { data: [] };
  const zones = TIMEZONES.includes(org.timezone) ? TIMEZONES : [org.timezone, ...TIMEZONES];

  return (
    <>
      <PageHeader title="Settings" description="Your organisation, your profile, and your data." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Organisation" description={isAdmin ? "Shown to customers in reminder emails." : "Only admins can edit these details."} />
          <CardBody>
            <ActionForm action={saveOrganisation} className="flex flex-col gap-4">
              <FormField name="name" label="Display name"><Input id="name" name="name" defaultValue={org.name} disabled={!isAdmin} /></FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField name="legal_name" label="Legal name"><Input id="legal_name" name="legal_name" defaultValue={org.legal_name ?? ""} disabled={!isAdmin} /></FormField>
                <FormField name="tax_id" label="Tax ID (GSTIN / VAT / EIN)"><Input id="tax_id" name="tax_id" defaultValue={org.tax_id ?? ""} disabled={!isAdmin} /></FormField>
              </div>
              <FormField name="billing_email" label="Billing email" hint="Receives Capflow subscription receipts."><Input id="billing_email" name="billing_email" type="email" defaultValue={org.billing_email ?? ""} disabled={!isAdmin} /></FormField>
              <FormField name="address" label="Address"><Textarea id="address" name="address" defaultValue={org.address ?? ""} className="min-h-16" disabled={!isAdmin} /></FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField name="timezone" label="Time zone" hint="Controls due dates, overdue days and sending hours.">
                  <Select id="timezone" name="timezone" defaultValue={org.timezone} disabled={!isAdmin}>{zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}</Select>
                </FormField>
                <FormField name="base_currency" label="Base currency" hint="Fixed once created."><Input id="base_currency" value={org.base_currency} disabled readOnly /></FormField>
              </div>
              {isAdmin ? <div><SubmitButton>Save organisation</SubmitButton></div> : null}
            </ActionForm>
          </CardBody>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Your profile" description={`${user.email} · ${ROLE_LABELS[role]}`} />
            <CardBody>
              <ActionForm action={saveProfile} className="flex flex-col gap-4">
                <FormField name="full_name" label="Full name"><Input id="full_name" name="full_name" defaultValue={user.fullName ?? ""} /></FormField>
                <div className="flex flex-wrap gap-2"><SubmitButton>Save profile</SubmitButton><Button variant="secondary" asChild><Link href="/forgot-password"><KeyRound />Change password</Link></Button></div>
              </ActionForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Your data" description="Export everything this organisation holds in Capflow (GDPR / DPDP access request)." />
            <CardBody className="flex flex-wrap gap-2">
              <Button variant="secondary" asChild><a href="/api/export/invoices"><Download />Invoices (CSV)</a></Button>
              {isAdmin ? <Button variant="secondary" asChild><a href="/api/export/account"><Download />Full organisation export (JSON)</a></Button> : null}
            </CardBody>
          </Card>
        </div>
      </div>

      {isAdmin ? (
        <Card className="mt-4">
          <CardHeader title="Audit log" description="The 25 most recent actions. Audit entries cannot be edited or deleted." />
          <div className="mt-4"><Table>
            <thead><tr><Th>When</Th><Th>Action</Th><Th>Record</Th><Th>By</Th></tr></thead>
            <tbody>{(audit ?? []).map((a) => (
              <Tr key={a.id}><Td className="whitespace-nowrap text-muted">{formatDateTime(a.created_at, org.timezone)}</Td><Td className="font-mono text-xs">{a.action}</Td><Td className="text-muted">{a.entity_type}</Td><Td className="text-muted">{a.actor_type === "system" ? "Automation" : "Team member"}</Td></Tr>
            ))}</tbody>
          </Table></div>
        </Card>
      ) : null}

      {role === "owner" ? (
        <Card className="mt-4 border-danger-100">
          <CardHeader title="Delete organisation" description="Members lose access immediately. Financial records are retained for the statutory retention period (commonly 8 years in India, 6 in the UK, 7 in the US) and then permanently erased. Export your data first." />
          <CardBody>
            <ActionForm action={deleteOrganisation} className="flex flex-wrap items-end gap-3">
              <FormField name="confirm" label={`Type "${org.name}" to confirm`} className="min-w-64 flex-1"><Input id="confirm" name="confirm" autoComplete="off" /></FormField>
              <SubmitButton variant="danger">Delete organisation</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
