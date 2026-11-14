import { describe, expect, it } from "vitest";
import { buildInsights } from "@/lib/insights";
import { can } from "@/lib/permissions";
import { dbErrorMessage } from "@/lib/result";
import { renderTemplate, unknownVariables } from "@/lib/templates";
import type { CustomerStats, DashboardSummary } from "@/lib/types";
import { invoiceSchema, paymentSchema } from "@/lib/validation/schemas";

describe("templates", () => {
  it("renders known variables and leaves unknown ones visible", () => {
    expect(renderTemplate("Hi {{customer_name}} {{ invoice_number }} {{nope}}", { customer_name: "Asha", invoice_number: "INV-1" })).toBe("Hi Asha INV-1 {{nope}}");
    expect(unknownVariables("{{customer_name}} {{amount}}")).toEqual(["amount"]);
  });
});

describe("permissions", () => {
  it("follows the role ladder", () => {
    expect(can("owner", "admin")).toBe(true);
    expect(can("accountant", "finance_manager")).toBe(false);
    expect(can("viewer", "viewer")).toBe(true);
  });
});

describe("database error messages", () => {
  it("surfaces Capflow errors and hides internals", () => {
    expect(dbErrorMessage({ message: "CAPFLOW:overpayment:Allocation exceeds the outstanding balance." })).toBe("Allocation exceeds the outstanding balance.");
    expect(dbErrorMessage({ code: "42501", message: "new row violates row-level security policy" })).toBe("You don't have permission to do that.");
    expect(dbErrorMessage({ code: "23505", message: 'duplicate key "invoices_organisation_id_invoice_number_key"' })).toBe("An invoice with that number already exists.");
  });
});

describe("validation", () => {
  const item = { description: "Work", quantity: "1", unit_price: "100.00", tax_rate: "18" };
  const base = { customer_id: "11111111-1111-4111-8111-111111111111", invoice_number: "INV-1", issue_date: "2026-11-01", due_date: "2026-11-30", currency: "INR", notes: "", payment_reference: "", items: [item] };

  it("accepts a valid invoice and rejects bad ones", () => {
    expect(invoiceSchema.safeParse(base).success).toBe(true);
    expect(invoiceSchema.safeParse({ ...base, due_date: "2026-10-01" }).success).toBe(false);
    expect(invoiceSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    expect(invoiceSchema.safeParse({ ...base, items: [{ ...item, unit_price: "1.005" }] }).success).toBe(false);
    expect(invoiceSchema.safeParse({ ...base, currency: "XYZ" }).success).toBe(false);
  });

  it("rejects non-positive and over-precise payments", () => {
    const pay = { customer_id: base.customer_id, amount: "10.00", currency: "INR", payment_date: "2026-11-01", method: "upi", reference: "", notes: "", idempotency_key: "key-12345", allocations: [], confirm_duplicate: false };
    expect(paymentSchema.safeParse(pay).success).toBe(true);
    for (const amount of ["0", "-5", "1.001", "abc"]) expect(paymentSchema.safeParse({ ...pay, amount }).success).toBe(false);
  });
});

describe("insights", () => {
  const money = (v: number) => `₹${v.toFixed(2)}`;
  const customer = (over: Partial<CustomerStats>): CustomerStats => ({
    customer_id: "c1", customer_name: "Globex", customer_email: null, currency: "INR", invoice_count: 5, open_invoice_count: 3,
    overdue_invoice_count: 3, overdue_30_plus_count: 0, total_invoiced: 0, total_paid: 0, outstanding: 1000, overdue: 800,
    max_days_overdue: 10, avg_days_late: 5, recent_avg_days_late: null, recent_paid_count: 0, prior_avg_days_late: null,
    prior_paid_count: 0, last_paid_on: null, broken_promises: 0, pending_promises: 0, risk_score: 0, risk_level: "low", ...over,
  });

  it("reports customers with several 30+ day overdue invoices with evidence", () => {
    const [insight] = buildInsights(null, [customer({ overdue_30_plus_count: 3, recent_avg_days_late: 40, prior_avg_days_late: 12, recent_paid_count: 2, prior_paid_count: 2 })], [], { money, trendRange: "" });
    expect(insight.title).toBe("Globex has 3 invoices overdue by more than 30 days");
    expect(insight.detail).toContain("rose from 12 to 40 days");
    expect(insight.severity).toBe("critical");
    expect(insight.evidence.length).toBeGreaterThan(0);
  });

  it("produces nothing when there is nothing notable", () => {
    const summary = { outstanding: 1000, ageing: {} } as unknown as DashboardSummary;
    expect(buildInsights(summary, [customer({})], [], { money, trendRange: "" })).toEqual([]);
  });
});
