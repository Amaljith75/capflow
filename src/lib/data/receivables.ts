import "server-only";
import type { AppContext } from "@/lib/auth/context";
import type { CustomerStats, DashboardSummary, TrendPoint } from "@/lib/types";

/** Currencies with invoices in this organisation, plus the one to report in. Amounts are never converted. */
export async function resolveCurrency(ctx: AppContext, requested: string | undefined): Promise<{ currency: string; available: string[] }> {
  const { data } = await ctx.supabase.rpc("currencies_in_use", { p_org: ctx.org.id });
  const available = ((data ?? []) as { currency: string }[]).map((r) => r.currency);
  if (!available.includes(ctx.org.base_currency)) available.unshift(ctx.org.base_currency);
  const currency = requested && available.includes(requested) ? requested : available.includes(ctx.org.base_currency) ? ctx.org.base_currency : available[0];
  return { currency, available };
}

export async function loadSummary(ctx: AppContext, currency: string): Promise<DashboardSummary> {
  const { data, error } = await ctx.supabase.rpc("dashboard_summary", { p_org: ctx.org.id, p_currency: currency });
  if (error) throw new Error(error.message);
  return data as DashboardSummary;
}

export async function loadTrend(ctx: AppContext, currency: string, months: number): Promise<TrendPoint[]> {
  const { data, error } = await ctx.supabase.rpc("cashflow_trend", { p_org: ctx.org.id, p_currency: currency, p_months: months });
  if (error) throw new Error(error.message);
  return ((data ?? []) as TrendPoint[]).map((p) => ({
    month: p.month, invoiced: Number(p.invoiced), collected: Number(p.collected), outstanding_end: Number(p.outstanding_end),
  }));
}

/** Customers with an open balance in the currency, highest risk first. */
export async function loadCustomerStats(ctx: AppContext, currency: string): Promise<CustomerStats[]> {
  const { data, error } = await ctx.supabase.from("customer_stats").select("*")
    .eq("organisation_id", ctx.org.id).eq("currency", currency).gt("outstanding", 0)
    .order("risk_score", { ascending: false }).order("outstanding", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return ((data ?? []) as CustomerStats[]).map((c) => ({ ...c, outstanding: Number(c.outstanding), overdue: Number(c.overdue) }));
}

export const AGEING_BUCKETS = [
  { key: "not_due", label: "Not due" },
  { key: "1_30", label: "1–30 days" },
  { key: "31_60", label: "31–60 days" },
  { key: "61_90", label: "61–90 days" },
  { key: "90_plus", label: "90+ days" },
] as const;
