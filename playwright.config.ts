import { defineConfig, devices } from "@playwright/test";

/**
 * Public-page tests run against any build. The authenticated journey in
 * e2e/recovery-flow.spec.ts needs a real Supabase project (local `supabase start`
 * or a staging project) with the migrations applied and email confirmation
 * disabled; set E2E_SUPABASE=1 to enable it.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100", trace: "off" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: "npm run build && npx next start -p 3100",
    url: "http://127.0.0.1:3100",
    timeout: 240_000,
    reuseExistingServer: true,
  },
});
