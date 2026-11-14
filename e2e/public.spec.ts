import { expect, test } from "@playwright/test";

test("landing page explains the product and links to sign-up", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Get paid/ })).toBeVisible();
  await expect(page.getByText("₹1,499")).toBeVisible();
  await page.getByRole("link", { name: "Start 14-day free trial" }).click();
  await expect(page).toHaveURL(/\/signup/);
});

test("signed-out visitors are sent to login, keeping their destination", async ({ page }) => {
  await page.goto("/invoices");
  await expect(page).toHaveURL(/\/login\?next=%2Finvoices/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("sign-up form validates on the client", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Asha Rao");
  await page.getByLabel("Work email").fill("asha@example.com");
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/signup/);
});

test("security headers are set", async ({ request }) => {
  const res = await request.get("/login");
  expect(res.headers()["x-frame-options"]).toBe("DENY");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
});

test("webhooks reject unsigned requests", async ({ request }) => {
  for (const path of ["/api/webhooks/stripe", "/api/webhooks/razorpay", "/api/webhooks/resend"]) {
    const res = await request.post(path, { data: { id: "evt_forged" } });
    expect([400, 503]).toContain(res.status());
  }
});
