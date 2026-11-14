export const ROLES = ["viewer", "accountant", "finance_manager", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { viewer: 1, accountant: 2, finance_manager: 3, admin: 4, owner: 5 };

/** UI-level check. The database enforces the same ladder through RLS. */
export function can(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}

export const ROLE_LABELS: Record<Role, string> = {
  viewer: "Viewer",
  accountant: "Accountant",
  finance_manager: "Finance Manager",
  admin: "Admin",
  owner: "Owner",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  viewer: "Read-only access to invoices, customers and reports.",
  accountant: "Create and edit customers, invoices, payments and promises.",
  finance_manager: "Everything an accountant can do, plus approve reminders, void payments and configure automation.",
  admin: "Everything a finance manager can do, plus manage the team, integrations and organisation settings.",
  owner: "Full access including billing and deleting the organisation.",
};
