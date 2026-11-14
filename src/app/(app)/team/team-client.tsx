"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { ActionForm, FormField, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type Role } from "@/lib/permissions";
import { changeRole, inviteMember } from "./actions";

export function InviteDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [result, setResult] = React.useState<{ link: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [role, setRole] = React.useState<Role>("accountant");

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setResult(null); setCopied(false); } }}>
      <DialogTrigger asChild><Button><UserPlus />Invite member</Button></DialogTrigger>
      <DialogContent title="Invite a team member" description="They must sign in with the email address you invite.">
        {result ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink-soft">{result.emailed ? "The invitation email is on its way. You can also share this link:" : "Email sending is not configured, so no email was sent. Share this link with them directly:"}</p>
            <div className="flex gap-2">
              <Input readOnly value={result.link} onFocus={(e) => e.currentTarget.select()} aria-label="Invitation link" />
              <Button type="button" variant="secondary" onClick={async () => { await navigator.clipboard.writeText(result.link); setCopied(true); }}>
                {copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-xs text-muted">The link works once and expires in 7 days.</p>
            <div className="flex justify-end"><Button onClick={() => setOpen(false)}>Done</Button></div>
          </div>
        ) : (
          <ActionForm action={inviteMember} onSuccess={(r) => { setResult(r.data as { link: string; emailed: boolean }); router.refresh(); }} className="flex flex-col gap-4">
            <FormField name="email" label="Email address"><Input id="email" name="email" type="email" required placeholder="colleague@company.com" /></FormField>
            <FormField name="role" label="Role" hint={ROLE_DESCRIPTIONS[role]}>
              <Select id="role" name="role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {(["viewer", "accountant", "finance_manager", "admin"] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </Select>
            </FormField>
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <SubmitButton>Create invitation</SubmitButton>
            </div>
          </ActionForm>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RoleSelect({ memberId, role, canAssignOwner }: { memberId: string; role: Role; canAssignOwner: boolean }) {
  const router = useRouter();
  const [value, setValue] = React.useState(role);
  const [pending, startTransition] = React.useTransition();
  const options: Role[] = canAssignOwner ? ["viewer", "accountant", "finance_manager", "admin", "owner"] : ["viewer", "accountant", "finance_manager", "admin"];
  return (
    <Select aria-label="Role" className="h-9 w-44 text-[13px]" value={value} disabled={pending}
      onChange={(e) => {
        const next = e.target.value as Role;
        const previous = value;
        setValue(next);
        startTransition(async () => {
          const result = await changeRole(memberId, next);
          if (result.ok) { toast.success(result.message ?? "Role updated."); router.refresh(); }
          else { toast.error(result.error); setValue(previous); }
        });
      }}>
      {options.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
    </Select>
  );
}
