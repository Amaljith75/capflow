/** RFC 4180 CSV parsing and safe CSV generation. */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const input = text.replace(/^﻿/, "");

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

export function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/** Parses CSV text into objects keyed by normalised header. */
export function csvToObjects(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const [headerRow, ...dataRows] = parseCsv(text);
  if (!headerRow) return { headers: [], rows: [] };
  const headers = headerRow.map(normaliseHeader);
  const rows = dataRows.map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) record[header] = (cells[index] ?? "").trim();
    });
    return record;
  });
  return { headers, rows };
}

/** Escapes a cell and neutralises spreadsheet formula injection. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Strips currency symbols and thousands separators: "₹1,23,456.50" → "123456.50". */
export function cleanAmount(value: string): string {
  return value.replace(/[^\d.-]/g, "");
}
