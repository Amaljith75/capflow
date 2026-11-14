import { describe, expect, it } from "vitest";
import { formatMoney, fromMinor, invoiceTotals, isValidAmount, lineTotals, parseScaled, toMinor } from "@/lib/money";

describe("decimal-safe money", () => {
  it("parses and prints without floating point drift", () => {
    expect(toMinor("0.1") + toMinor("0.2")).toBe(30n);
    expect(fromMinor(toMinor("0.1") + toMinor("0.2"))).toBe("0.30");
    expect(fromMinor(-5n)).toBe("-0.05");
    expect(fromMinor(123456789n)).toBe("1234567.89");
  });

  it("rejects malformed and over-precise input", () => {
    expect(() => parseScaled("1.234", 2)).toThrow();
    expect(() => parseScaled("1e3", 2)).toThrow();
    expect(isValidAmount("12.5")).toBe(true);
    expect(isValidAmount("12,5")).toBe(false);
  });

  it("matches the database's line maths (round half away from zero)", () => {
    // Same cases as worker/tests/test_db_financial.py::test_totals_are_calculated_exactly_from_line_items
    const lines = [
      { quantity: "3", unitPrice: "199.99", taxRate: "18" },
      { quantity: "1", unitPrice: "0.10", taxRate: "5" },
      { quantity: "1", unitPrice: "50.00", taxAmount: "4.37" },
    ];
    const t = invoiceTotals(lines);
    expect(fromMinor(t.subtotal)).toBe("650.07");
    expect(fromMinor(t.tax)).toBe("112.37");
    expect(fromMinor(t.total)).toBe("762.44");
  });

  it("rounds fractional quantities to the cent", () => {
    expect(fromMinor(lineTotals({ quantity: "2.5", unitPrice: "0.33" }).subtotal)).toBe("0.83"); // 0.825 → 0.83
    expect(fromMinor(lineTotals({ quantity: "0.001", unitPrice: "4.99" }).subtotal)).toBe("0.00");
  });

  it("ignores the fixed tax amount when a rate is given", () => {
    expect(fromMinor(lineTotals({ quantity: "1", unitPrice: "100", taxRate: "10", taxAmount: "99" }).tax)).toBe("10.00");
  });

  it("formats with the right grouping per currency", () => {
    expect(formatMoney("1234567.5", "INR")).toBe("₹12,34,567.50");
    expect(formatMoney(1234567.5, "USD")).toBe("$1,234,567.50");
    expect(formatMoney(null, "USD")).toBe("—");
  });
});
