import { NextResponse } from "next/server";
import { requireContext } from "@/lib/auth/context";
import { can } from "@/lib/permissions";

const TABLES = ["customers", "invoices", "invoice_items", "payments", "payment_allocations", "payment_promises", "reminders", "communication_logs", "communication_templates", "automation_rules", "automation_rule_steps", "recovery_workflows", "audit_logs", "subscriptions"] as const;

/** Full organisation export for data-portability requests. Secrets are never included. */
export async function GET() {
  const { supabase, org, role, user } = await requireContext();
  if (!can(role, "admin")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const out: Record<string, unknown> = { exported_at: new Date().toISOString(), exported_by: user.email, organisation: org };
  for (const table of TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from(table).select("*").eq("organisation_id", org.id).range(from, from + 999);
      if (error) return NextResponse.json({ error: `export of ${table} failed` }, { status: 500 });
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    out[table] = rows;
  }
  await supabase.rpc("log_audit", { p_org: org.id, p_action: "organisation.exported", p_entity_type: "organisation", p_entity_id: org.id, p_metadata: {} });
  return new NextResponse(JSON.stringify(out, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="capflow-export-${org.slug}.json"`, "Cache-Control": "no-store" },
  });
}
