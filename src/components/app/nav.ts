import {
  BarChart3, Bot, Building2, CreditCard, FileText, LayoutGrid, MessagesSquare, Plug, Settings, ShieldAlert, Users, Wallet,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badgeKey?: "approvals";
}

export const NAV: { heading: string; items: NavItem[] }[] = [
  {
    heading: "Main menu",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutGrid },
      { href: "/invoices", label: "Invoices", icon: FileText },
      { href: "/customers", label: "Customers", icon: Building2 },
      { href: "/payments", label: "Payments", icon: Wallet },
    ],
  },
  {
    heading: "Recovery",
    items: [
      { href: "/recovery", label: "Recovery", icon: ShieldAlert, badgeKey: "approvals" },
      { href: "/automations", label: "Automations", icon: Bot },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/communications", label: "Communications", icon: MessagesSquare },
    ],
  },
  {
    heading: "Workspace",
    items: [
      { href: "/team", label: "Team", icon: Users },
      { href: "/integrations", label: "Integrations", icon: Plug },
      { href: "/billing", label: "Billing", icon: CreditCard },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function navLabel(pathname: string): string {
  for (const group of NAV) for (const item of group.items) if (pathname.startsWith(item.href)) return item.label;
  return "Overview";
}
