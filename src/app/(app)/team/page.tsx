import type { Metadata } from "next";
import { ActionButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { getEntitlements, requireContext } from "@/lib/auth/context";
import { formatDate } from "@/lib/dates";
import { can, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, type Role } from "@/lib/permissions";
import { initials } from "@/lib/utils";
import { removeMember, revokeInvitation } from "./actions";
import { InviteDialog, RoleSelect } from "./team-client";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const { supabase, org, role, user } = await requireContext();
  const entitlements = await getEntitlements();
  const isAdmin = can(role, "admin");
  const [{ data: members }, { data: invitations }] = await Promise.all([
    supabase.from("organisation_members").select("id, user_id, role, created_at").eq("organisation_id", org.id).order("created_at"),
    isAdmin
      ? supabase.from("organisation_invitations").select("id, email, role, expires_at, created_at").eq("organisation_id", org.id)
          .is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);
  const { data: profiles } = await supabase.from("profiles").select("id, email, full_name").in("id", (members ?? []).map((m) => m.user_id));
  const profile = new Map((profiles ?? []).map((p) => [p.id, p]));
  const limit = entitlements.limits.max_users ?? null;
  const used = (members ?? []).length + (invitations ?? []).length;

  return (
    <>
      <PageHeader title="Team" description={`${(members ?? []).length} member${(members ?? []).length === 1 ? "" : "s"}${limit !== null ? ` of ${limit} included in your plan` : ""}.`}
        actions={isAdmin ? (limit !== null && used >= limit ? <Badge tone="amber">Seat limit reached. Upgrade to invite more</Badge> : <InviteDialog />) : null} />
      <Card>
        <Table>
          <thead><tr><Th>Member</Th><Th>Role</Th><Th>Joined</Th><Th /></tr></thead>
          <tbody>
            {(members ?? []).map((m) => {
              const p = profile.get(m.user_id);
              const self = m.user_id === user.id;
              const editable = isAdmin && !self && (m.role !== "owner" || role === "owner");
              return (
                <Tr key={m.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <span className="flex size-9 items-center justify-center rounded-xl bg-brand-100 text-xs font-semibold text-brand-800">{initials(p?.full_name ?? p?.email)}</span>
                      <div><p className="font-medium">{p?.full_name ?? p?.email ?? "Member"}{self ? <span className="ml-2 text-xs font-normal text-faint">you</span> : null}</p><p className="text-xs text-muted">{p?.email}</p></div>
                    </div>
                  </Td>
                  <Td>{editable ? <RoleSelect memberId={m.id} role={m.role as Role} canAssignOwner={role === "owner"} /> : <Badge tone={m.role === "owner" ? "dark" : "neutral"}>{ROLE_LABELS[m.role as Role]}</Badge>}</Td>
                  <Td className="text-muted">{formatDate(m.created_at)}</Td>
                  <Td className="text-right">
                    {editable || (self && m.role !== "owner") ? (
                      <ActionButton size="sm" variant="ghost" action={removeMember.bind(null, m.id)} redirectTo={self ? "/dashboard" : undefined}
                        confirm={{ title: self ? `Leave ${org.name}?` : "Remove this member?", description: self ? "You will lose access immediately." : "They lose access immediately. Their past actions stay in the audit log.", confirmLabel: self ? "Leave organisation" : "Remove member", danger: true }}>
                        {self ? "Leave" : "Remove"}
                      </ActionButton>
                    ) : null}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {isAdmin && (invitations ?? []).length > 0 ? (
        <Card className="mt-4">
          <CardHeader title="Pending invitations" />
          <div className="mt-4">
            <Table>
              <thead><tr><Th>Email</Th><Th>Role</Th><Th>Expires</Th><Th /></tr></thead>
              <tbody>
                {(invitations ?? []).map((i) => (
                  <Tr key={i.id}>
                    <Td className="font-medium">{i.email}</Td><Td>{ROLE_LABELS[i.role as Role]}</Td><Td className="text-muted">{formatDate(i.expires_at)}</Td>
                    <Td className="text-right"><ActionButton size="sm" variant="ghost" action={revokeInvitation.bind(null, i.id)}>Revoke</ActionButton></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      ) : null}

      <Card className="mt-4">
        <CardHeader title="What each role can do" description="Permissions are enforced in the database, not just in the interface." />
        <CardBody>
          <dl className="grid gap-x-8 gap-y-4 md:grid-cols-2">
            {[...ROLES].reverse().map((r) => (
              <div key={r}><dt className="text-sm font-medium">{ROLE_LABELS[r]}</dt><dd className="mt-0.5 text-[13px] text-muted">{ROLE_DESCRIPTIONS[r]}</dd></div>
            ))}
          </dl>
        </CardBody>
      </Card>
    </>
  );
}
