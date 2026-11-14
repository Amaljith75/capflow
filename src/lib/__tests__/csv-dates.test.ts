import { describe, expect, it } from "vitest";
import { cleanAmount, csvCell, csvToObjects, parseCsv, toCsv } from "@/lib/csv";
import { addDays, isIsoDate, parseFlexibleDate } from "@/lib/dates";

describe("csv", () => {
  it("parses quotes, escaped quotes, CRLF, BOM and blank lines", () => {
    const rows = parseCsv('﻿name,notes\r\n"Acme, Inc","He said ""hi"""\r\n\r\nBeta,"multi\nline"\n');
    expect(rows).toEqual([["name", "notes"], ["Acme, Inc", 'He said "hi"'], ["Beta", "multi\nline"]]);
  });

  it("normalises headers", () => {
    const { headers, rows } = csvToObjects("Invoice Number,Due Date\nINV-1, 2026-01-01 \n");
    expect(headers).toEqual(["invoice_number", "due_date"]);
    expect(rows[0]).toEqual({ invoice_number: "INV-1", due_date: "2026-01-01" });
  });

  it("neutralises spreadsheet formula injection on export", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-12.50")).toBe("-12.50");
    expect(toCsv(["a"], [["x,y"]])).toBe('a\r\n"x,y"\r\n');
  });

  it("cleans formatted amounts", () => {
    expect(cleanAmount("₹1,23,456.50")).toBe("123456.50");
    expect(cleanAmount("$ 99")).toBe("99");
  });
});

describe("dates", () => {
  it("accepts ISO and day-first formats and rejects impossible dates", () => {
    expect(parseFlexibleDate("2026-02-28")).toBe("2026-02-28");
    expect(parseFlexibleDate("5/3/2026")).toBe("2026-03-05");
    expect(parseFlexibleDate("31-04-2026")).toBeNull();
    expect(isIsoDate("2026-13-01")).toBe(false);
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
