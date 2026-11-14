export interface Failure {
  ok: false;
  error: string;
  fieldErrors?: Record<string, string[]>;
}

export type ActionResult<T = undefined> = { ok: true; message?: string; data?: T } | Failure;

interface DbErrorLike {
  message?: string;
  code?: string;
  details?: string | null;
}

/** Converts a database / PostgREST error into a message that is safe to show a user. */
export function dbErrorMessage(error: DbErrorLike | null | undefined, fallback = "Something went wrong. Please try again."): string {
  if (!error) return fallback;
  const message = error.message ?? "";
  const match = /CAPFLOW:([a-z_]+):(.+)/s.exec(message);
  if (match) return match[2].trim();
  if (error.code === "23505") {
    if (message.includes("invoices_organisation_id_invoice_number_key")) return "An invoice with that number already exists.";
    return "That record already exists.";
  }
  if (error.code === "42501" || message.includes("row-level security")) return "You don't have permission to do that.";
  if (error.code === "23503") return "That record is referenced by other data and cannot be removed.";
  if (error.code === "23514") return "One of the values is outside the allowed range.";
  if (error.code === "22P02" || error.code === "22007") return "One of the values has an invalid format.";
  console.error("[capflow] unexpected database error", { code: error.code, message });
  return fallback;
}

export function fail(error: string, fieldErrors?: Record<string, string[]>): Failure {
  return { ok: false, error, fieldErrors };
}

export function zodFail(issues: { path: PropertyKey[]; message: string }[]): Failure {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".") || "_";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  const first = issues[0];
  return { ok: false, error: first ? first.message : "Please check the form.", fieldErrors };
}
