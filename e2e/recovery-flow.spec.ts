import { expect, test } from "@playwright/test";

/**
 * End-to-end financial journey against a real Supabase backend:
 * sign up → create organisation → customer → invoice → partial payment → full payment.
 */
test.skip(!process.env.E2E_SUPABASE, "requires a Supabase backend (set E2E_SUPABASE=1)");
test.describe.configure({ mode: "serial" });

test("recover an invoice from creation to paid", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("E2E Owner");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);

  await page.getByLabel("Business name").fill("E2E Traders");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText("Bring in the invoices you are waiting to be paid for")).toBeVisible();

  await page.goto("/customers");
  await page.getByRole("button", { name: "Add customer" }).first().click();
  await page.getByLabel("Customer / business name").fill("Globex Pvt Ltd");
  await page.getByLabel("Billing email").fill("ap@globex.example");
  await page.getByRole("dialog").getByRole("button", { name: "Add customer" }).click();
  await expect(page.getByRole("link", { name: "Globex Pvt Ltd" })).toBeVisible();

  await page.goto("/invoices/new");
  await page.getByLabel("Customer").selectOption({ label: "Globex Pvt Ltd" });
  await page.getByLabel("Invoice number").fill("E2E-001");
  await page.getByLabel("Line 1 description").fill("Consulting");
  await page.getByLabel("Line 1 unit price").fill("1000");
  await page.getByLabel("Line 1 tax rate").fill("18");
  await expect(page.getByText("₹1,180.00").first()).toBeVisible();
  await page.getByRole("button", { name: "Save and mark as sent" }).click();
  await expect(page.getByRole("heading", { name: "E2E-001" })).toBeVisible();

  for (const [amount, status] of [["500", "Partially Paid"], ["680", "Paid"]] as const) {
    await page.getByRole("link", { name: "Record payment" }).click();
    await page.getByLabel(/Amount received/).fill(amount);
    await page.getByRole("button", { name: "Record payment" }).last().click();
    await page.goto("/invoices?view=all");
    await page.getByRole("link", { name: "E2E-001" }).click();
    await expect(page.getByText(status, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText("Paid in full")).toBeVisible();
});
