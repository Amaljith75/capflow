/** Message template rendering. The Python worker implements the same rules in capflow_worker/templates.py. */

export const TEMPLATE_VARIABLES = [
  "customer_name", "invoice_number", "amount_outstanding", "invoice_total", "due_date", "days_overdue", "organisation_name", "payment_reference",
] as const;

export type TemplateVars = Record<(typeof TEMPLATE_VARIABLES)[number], string>;

/** Replaces {{variable}} placeholders. Unknown placeholders are left visible so mistakes are noticed before sending. */
export function renderTemplate(template: string, vars: Partial<TemplateVars>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, name: string) => {
    const value = (vars as Record<string, string | undefined>)[name];
    return value !== undefined ? value : match;
  });
}

export function unknownVariables(template: string): string[] {
  const names = new Set<string>();
  for (const match of template.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) {
    if (!(TEMPLATE_VARIABLES as readonly string[]).includes(match[1])) names.add(match[1]);
  }
  return [...names];
}
