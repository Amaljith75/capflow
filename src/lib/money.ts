/**
 * Decimal-safe money helpers.
 *
 * Amounts are stored in PostgreSQL as numeric(14,2) and all authoritative
 * arithmetic happens in the database. The helpers here exist for form previews
 * and client-side validation; they use BigInt minor units and never touch
 * floating point. Rounding is half away from zero, identical to PostgreSQL's
 * round(numeric, 2).
 */

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/** Parses a decimal string into an integer scaled by 10^scale. Throws on malformed input. */
export function parseScaled(value: string, scale: number): bigint {
  const text = value.trim();
  if (!DECIMAL_RE.test(text)) throw new Error(`Invalid decimal: "${value}"`);
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = (negative ? text.slice(1) : text).split(".");
  if (fraction.length > scale) throw new Error(`Too many decimal places: "${value}"`);
  const scaled = BigInt(whole + fraction.padEnd(scale, "0"));
  return negative ? -scaled : scaled;
}

/** Amount string ("1234.50") → minor units (123450n). */
export function toMinor(value: string | number): bigint {
  const text = typeof value === "number" ? value.toFixed(2) : value;
  return parseScaled(text, 2);
}

/** Minor units (123450n) → amount string ("1234.50"). */
export function fromMinor(minor: bigint): string {
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** Divides by 10^places rounding half away from zero. */
function roundDiv(value: bigint, places: number): bigint {
  const divisor = 10n ** BigInt(places);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const quotient = (abs + divisor / 2n) / divisor;
  return negative ? -quotient : quotient;
}

export interface LineInput {
  quantity: string;
  unitPrice: string;
  /** Percentage, e.g. "18" or "12.5". Empty/undefined = no tax. */
  taxRate?: string | null;
  /** Explicit tax amount, used only when no rate is given (imported invoices). */
  taxAmount?: string | null;
}

export interface LineTotals {
  subtotal: bigint;
  tax: bigint;
  total: bigint;
}

/** Mirrors app.invoice_items_before(): round(qty*price, 2), then round(subtotal*rate/100, 2). */
export function lineTotals(line: LineInput): LineTotals {
  const quantity = parseScaled(line.quantity, 3);
  const unitPrice = parseScaled(line.unitPrice, 2);
  const subtotal = roundDiv(quantity * unitPrice, 3);
  const rate = line.taxRate && line.taxRate.trim() !== "" ? parseScaled(line.taxRate, 4) : 0n;
  const hasRate = Boolean(line.taxRate && line.taxRate.trim() !== "");
  const tax = hasRate ? roundDiv(subtotal * rate, 6) : line.taxAmount ? parseScaled(line.taxAmount, 2) : 0n;
  return { subtotal, tax, total: subtotal + tax };
}

export function invoiceTotals(lines: LineInput[]): LineTotals {
  return lines.reduce<LineTotals>(
    (acc, line) => {
      const t = lineTotals(line);
      return { subtotal: acc.subtotal + t.subtotal, tax: acc.tax + t.tax, total: acc.total + t.total };
    },
    { subtotal: 0n, tax: 0n, total: 0n },
  );
}

export function isValidAmount(value: string): boolean {
  try {
    parseScaled(value, 2);
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.NumberFormat>();

/** Formats an amount for display. Accepts DB numerics (number) or decimal strings. */
export function formatMoney(value: string | number | null | undefined, currency: string, compact = false): string {
  if (value === null || value === undefined || value === "") return "—";
  const key = `${currency}:${compact}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
      ...(compact ? { notation: "compact", maximumFractionDigits: 1 } : { minimumFractionDigits: 2 }),
    });
    formatters.set(key, formatter);
  }
  // Intl accepts decimal strings exactly; numbers here are < 2^53 with 2 decimals.
  return formatter.format(value as number);
}

export const CURRENCIES = [
  { code: "INR", label: "Indian Rupee (₹)" },
  { code: "USD", label: "US Dollar ($)" },
  { code: "GBP", label: "British Pound (£)" },
  { code: "AED", label: "UAE Dirham (AED)" },
  { code: "EUR", label: "Euro (€)" },
  { code: "SGD", label: "Singapore Dollar (S$)" },
  { code: "AUD", label: "Australian Dollar (A$)" },
  { code: "CAD", label: "Canadian Dollar (C$)" },
] as const;

export const CURRENCY_CODES: string[] = CURRENCIES.map((c) => c.code);
