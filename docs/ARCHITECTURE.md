# Capflow architecture

## System overview

```
 Browser ──HTTPS──▶ Next.js on Vercel ─────────────▶ Supabase
   (React,          · Server Components (reads)      · Postgres + RLS (source of truth)
    no secrets)     · Server Actions (writes)        · Auth (sessions, email verification)
                    · Route handlers (webhooks,      · Storage (private invoice files)
                      exports, health)                        ▲
                                                              │ direct Postgres (privileged role)
 Stripe / Razorpay / Resend / Meta / Twilio ──webhooks──▶ Next.js      │
                                                              │
                         Redis ◀── Celery beat ──▶ Python worker (Railway/Render)
                                                  · plan reminders   · dispatch messages
                                                  · break promises   · AI jobs, retries
```

## Key decisions

### 1. The database enforces the rules, not the UI
Tenant isolation, roles, financial invariants and plan limits live in Postgres (migrations 0002 and 0004):

- **RLS on every table.** Every organisation-owned row carries `organisation_id`; policies call `app.is_org_member()` / `app.has_min_role()`. The browser only ever holds the anon key and the user's session. The service role is used only by webhooks, the unsubscribe page and secret storage.
- **Balances are derived, not written.** `invoice_items` → `invoices.subtotal/tax_total/total` and `payment_allocations` → `amount_paid` → status are maintained by triggers. A guard trigger rejects direct writes to totals or a manual change to `paid`; the only way to mark an invoice paid is to record a payment.
- **Immutable ledger.** Payments and allocations cannot be updated or deleted (trigger + no grant). Corrections are voids with a reason, which recompute balances. `audit_logs` is append-only.
- **Allocation invariants** checked in triggers: same organisation, customer and currency; never above the invoice's outstanding balance; never above the payment amount; never to drafts, cancelled or paid invoices.
- **Plan limits** (`app.require_feature`, `app.require_under_limit`) are checked in insert triggers, so a modified client cannot exceed them.
- **Errors** are raised as `CAPFLOW:<code>:<message>` and shown to users verbatim; other database errors are mapped to safe messages (`src/lib/result.ts`).

### 2. Decimal-safe money
Postgres `numeric(14,2)` everywhere. Line tax is `round(round(qty × price, 2) × rate / 100, 2)` (half away from zero). The browser preview (`src/lib/money.ts`) uses BigInt minor units with identical rounding; tests assert both sides produce the same results. AI is never involved in any calculation.

### 3. "Overdue" is derived
`invoice_ledger` (a `security_invoker` view) computes `effective_status`, `days_overdue` and `ageing_bucket` from the due date in the organisation's time zone. No nightly job flips statuses, so there is nothing to drift.

### 4. Multi-currency without conversion
Every aggregate (`dashboard_summary`, `cashflow_trend`, `collection_metrics`, `customer_stats`) is per currency. The UI offers a currency switcher. Converting would require an FX source and policy; it is deliberately out of scope.

### 5. Recovery engine (worker)
`worker/capflow_worker/recovery.py`.

- **Planner** (every 5 min): for each active workflow, finds the latest due step in the organisation's default sequence. Earlier unrun steps are recorded as *skipped* so they can never fire. Each step's reminder has `dedupe_key = step:<step>:<invoice>` (unique), so concurrent or repeated planner runs cannot duplicate it. Manual mode → `pending_approval`; auto mode → `scheduled` at the next working-hours window.
- **Escalation** steps send nothing: the workflow becomes `escalated` and finance managers are notified, once.
- **Dispatcher** (every minute): claims due reminders with `FOR UPDATE SKIP LOCKED` and commits the claim before any network call. Immediately before sending it re-checks invoice status, dispute, pause, pending promise, consent, subscription and working hours. Providers receive an idempotency key. Transient errors retry with exponential backoff (max 3 attempts), permanent errors fail and notify. A reminder stuck in `sending` (worker crash) is marked failed with "delivery unknown" — never resent automatically.
- **Workflow state** (`app.sync_workflow`) is derived from invoice + promise state by triggers: paid → completed, disputed → human_review (and pending reminders cancelled), promise → awaiting_promise, etc.
- **Promises** are fulfilled only by allocations recorded after the promise (baseline captured at creation). `app.mark_broken_promises()` breaks them only after the promised date passes in the organisation's time zone.

### 6. Background processing
- Celery + Redis for scheduling and retries; **Postgres is the source of truth** for idempotency, so Redis loss or double-delivery is harmless.
- `background_jobs` is a DB-backed queue for user-initiated work (AI redrafts, invoice extraction): SKIP LOCKED claims, exponential backoff, `dead` status as the dead-letter state with the last error kept.
- `python -m capflow_worker.loop` runs the same tasks without Redis for small deployments.
- Nothing depends on a Next.js request staying alive.

### 7. AI
`worker/capflow_worker/ai.py`: one client for OpenRouter, OpenAI, any OpenAI-compatible endpoint, and Anthropic. Outputs are JSON, validated with Pydantic, then by `validate_reminder`: no threats, legal/credit/collection language, invented fees, payment-received claims, links or placeholders; must contain the real invoice number and amount and no other amounts. Any failure falls back to the template. The product works fully with AI switched off.

### 8. Secrets
Tenant integration secrets (AI keys, WhatsApp token, Twilio token) are AES-256-GCM encrypted with `APP_ENCRYPTION_KEY` and stored in `integration_secrets`, which has RLS enabled and **no policies** (service role only). The UI is write-only. Platform secrets live only in server environment variables.

### 9. Webhooks
Stripe, Razorpay, Resend (Svix), Meta and Twilio signatures are verified over the raw body with constant-time comparison and timestamp tolerance where the scheme has one (`src/lib/webhook-signatures.ts`). Billing events are stored in `billing_events` keyed by `(provider, event_id)`; a processed event is never applied twice, a failed one returns 500 so the provider retries. Delivery statuses only move forward. Spam complaints and inbound STOP messages opt the customer out.

### 10. Rendering model
`cacheComponents` is off: every authenticated page is per-user, per-request financial data, so nothing is prerendered or shared between requests. Reads happen in Server Components through the user-scoped Supabase client; writes are Server Actions that re-check the role (`requireRole`) and rely on RLS as the final authority. `src/proxy.ts` only refreshes the session cookie and redirects signed-out users.

## Data model (summary)

`profiles`, `organisations`, `organisation_members`, `organisation_invitations` · `customers` · `invoices`, `invoice_items` · `payments`, `payment_allocations` · `payment_promises` · `automation_rules`, `automation_rule_steps`, `communication_templates`, `recovery_workflows`, `reminders`, `communication_logs` · `integration_configs`, `integration_secrets` · `subscription_plans`, `subscriptions`, `billing_events` · `audit_logs`, `background_jobs`, `notifications`, `rate_limits`.

Soft deletion: customers and invoices are archived (`archived_at`), organisations are soft-deleted (`deleted_at`). Only never-sent drafts can be hard-deleted.

## Security checklist
- RLS on all tables; tests prove cross-tenant reads and writes fail (`worker/tests/test_db_tenancy.py`).
- Server-side role checks in every action, mirrored by RLS.
- Zod validation on every input; CSV export neutralises formula injection.
- Rate limiting (Postgres fixed window) on sign-up, sign-in and password reset.
- Server Actions are POST-only with Next.js origin checks (CSRF); cookies are `SameSite=Lax`.
- Uploads: type allow-list, magic-byte check, 10 MB limit, private bucket, signed URLs valid for 60 s.
- Security headers (HSTS, frame-deny, nosniff, referrer policy).
- No card data: hosted checkout only.

## Privacy (GDPR / DPDP)
- Data access/portability: full JSON export (Settings).
- Erasure: organisation soft delete, followed by purge after the statutory retention period (implement as a scheduled SQL job per your legal advice; see DEPLOYMENT.md).
- Consent: per-channel opt-in/out with timestamps; unsubscribe link and `List-Unsubscribe` header on every email.
