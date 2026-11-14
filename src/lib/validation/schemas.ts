import { z } from "zod";
import { isIsoDate } from "@/lib/dates";
import { CURRENCY_CODES, isValidAmount } from "@/lib/money";

const optionalText = (max: number) =>
  z.string().trim().max(max).transform((v) => (v === "" ? null : v)).nullable().optional();

export const currency = z.enum(CURRENCY_CODES as [string, ...string[]], "Choose a supported currency.");
export const isoDate = z.string().refine(isIsoDate, "Enter a valid date.");
export const uuid = z.string().uuid("Invalid reference.");

/** Positive decimal with at most 2 places, kept as a string so no float is ever involved. */
export const amount = z
  .string()
  .trim()
  .refine((v) => isValidAmount(v) && !v.startsWith("-"), "Enter an amount with up to 2 decimal places.")
  .refine((v) => Number(v) > 0, "Amount must be greater than zero.")
  .refine((v) => Number(v) < 1_000_000_000_000, "Amount is too large.");

export const customerSchema = z.object({
  name: z.string().trim().min(1, "Enter the customer name.").max(200),
  email: z.union([z.literal(""), z.email("Enter a valid email address.")]).transform((v) => (v === "" ? null : v.toLowerCase())),
  phone: optionalText(30).refine((v) => !v || /^\+?[0-9 ()-]{6,}$/.test(v), "Enter a valid phone number, ideally with country code."),
  billing_address: optionalText(500),
  tax_id: optionalText(50),
  currency,
  payment_terms_days: z.coerce.number().int().min(0, "Must be 0 or more.").max(365, "Must be 365 or less."),
  notes: optionalText(2000),
});

export const invoiceItemSchema = z.object({
  description: z.string().trim().min(1, "Describe the item.").max(500),
  quantity: z.string().trim().regex(/^\d+(\.\d{1,3})?$/, "Up to 3 decimal places.").refine((v) => Number(v) > 0, "Must be more than 0."),
  unit_price: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Up to 2 decimal places."),
  tax_rate: z.string().trim().regex(/^(\d+(\.\d{1,4})?)?$/, "Enter a percentage.").refine((v) => v === "" || Number(v) <= 100, "Must be 100 or less."),
  /** Fixed tax carried over from an import; only used while tax_rate is empty. */
  tax_amount: z.string().regex(/^(\d+(\.\d{1,2})?)?$/).optional(),
});

export const invoiceSchema = z
  .object({
    customer_id: uuid,
    invoice_number: z.string().trim().min(1, "Enter an invoice number.").max(60),
    issue_date: isoDate,
    due_date: isoDate,
    currency,
    notes: z.string().trim().max(2000),
    payment_reference: z.string().trim().max(120),
    items: z.array(invoiceItemSchema).min(1, "Add at least one line item.").max(200),
  })
  .refine((v) => v.due_date >= v.issue_date, { path: ["due_date"], message: "Due date cannot be before the issue date." });

export type InvoiceInput = z.infer<typeof invoiceSchema>;

export const paymentSchema = z.object({
  customer_id: uuid,
  amount,
  currency,
  payment_date: isoDate,
  method: z.enum(["bank_transfer", "upi", "card", "cash", "cheque", "other"]),
  reference: z.string().trim().max(120),
  notes: z.string().trim().max(1000),
  idempotency_key: z.string().min(8).max(100),
  allocations: z.array(z.object({ invoice_id: uuid, amount })).max(100),
  confirm_duplicate: z.boolean(),
});

export type PaymentInput = z.infer<typeof paymentSchema>;

export const promiseSchema = z.object({
  invoice_id: uuid,
  promised_amount: amount,
  promised_date: isoDate,
  notes: optionalText(1000),
});

export const PAYMENT_METHODS: Record<string, string> = {
  bank_transfer: "Bank transfer", upi: "UPI", card: "Card", cash: "Cash", cheque: "Cheque", other: "Other",
};
