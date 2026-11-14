# Progress

Status of the phases in the original brief. "Done" means implemented and covered by tests or a successful build; "Not done" is listed honestly.

| Phase | Status |
| --- | --- |
| 1 Foundation: architecture, Next.js, schema, RLS, auth, organisations, design system | Done |
| 2 Core financial: customers, invoices, payments, partial payments, reconciliation, dashboard | Done |
| 3 Recovery engine: sequences, templates, promises, timeline, Python worker, Redis queue | Done |
| 4 AI: provider abstraction, personalised reminders, insights, invoice extraction | Done, except invoice-extraction UI (worker handler exists; no upload-to-extract screen yet). Insights are rule-based by design so every claim is verifiable. |
| 5 Integrations: email, WhatsApp, SMS, Razorpay, Stripe, webhooks | Adapters and webhooks done. Sequence editor currently offers email steps only; WhatsApp/SMS dispatch adapters exist but are not yet selectable per step. |
| 6 Commercial: plans, limits, team, billing portal, pricing page, onboarding | Done |
| 7 Production readiness | Security model, tests, docs, CI done. See open items. |

## Verified in this repository
- 31 Vitest unit tests, 82 Pytest tests (RLS, tenant isolation, money, payments, promises, plan limits, planner, dispatcher, retries, webhooks), 10 Playwright public-page tests: passing.
- `next build` succeeds; strict TypeScript, ESLint, ruff and strict mypy are clean.

## Not verified here
- The authenticated UI and the full Playwright journey (`e2e/recovery-flow.spec.ts`) were not run against a live Supabase instance in the build environment. Run `E2E_SUPABASE=1 npm run test:e2e` against a local `supabase start` stack before launch.
- No live calls to Resend, Stripe, Razorpay, Meta, Twilio or AI providers were made; adapters are tested with mocked HTTP.

## Open items before taking payments
1. Run the authenticated E2E suite against a staging Supabase project.
2. Create Stripe/Razorpay products and fill `provider_price_ids`.
3. Legal pages (terms, privacy policy, DPA) and a retention-purge job.
4. Error reporting (Sentry) and uptime alerts on `/api/health` and the worker `/health`.
5. Accounting/bank-feed integrations (not started; CSV import is the current path).
