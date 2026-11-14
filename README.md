# Capflow

**Get paid. Without chasing.**

Capflow is a multi-tenant SaaS for accounts-receivable automation. It tracks every unpaid invoice, follows up with customers on a configurable reminder sequence (optionally personalised by AI, always within safety rules), records payments and promises, and shows exactly how much money has been recovered.

| Part | Stack |
| --- | --- |
| Web app | Next.js 16 (App Router, Server Components, Server Actions), TypeScript (strict), Tailwind CSS 4, Radix primitives, Recharts, React Hook Form + Zod |
| Database & auth | Supabase: Postgres, Auth, Row Level Security, Storage |
| Background worker | Python 3.12+, Celery + Redis (or a Redis-free single-process loop), FastAPI health/admin API |
| Integrations | Resend (email), WhatsApp Cloud API, Twilio SMS, OpenRouter / Anthropic / OpenAI / any OpenAI-compatible AI, Stripe and Razorpay subscriptions |

- **How to use the product:** [docs/USER_GUIDE.md](docs/USER_GUIDE.md)
- **Architecture and decisions:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Deploying to production:** [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- **What is built, what is not:** [docs/PROGRESS.md](docs/PROGRESS.md)

---

## Quick start (local development)

### 1. Prerequisites

- Node.js 20+ and npm
- Python 3.12+ and [uv](https://docs.astral.sh/uv/)
- A Supabase project — either hosted ([supabase.com](https://supabase.com), free tier is fine) or local via the [Supabase CLI](https://supabase.com/docs/guides/local-development) (`supabase start`, needs Docker)
- Redis (optional: only for the Celery worker; the single-process loop works without it)

### 2. Database

Apply the migrations in `supabase/migrations/` **in filename order**:

```bash
# with the Supabase CLI, linked to your project
supabase link --project-ref YOUR-PROJECT-REF
supabase db push

# or paste each file, in order, into the Supabase SQL editor
```

Then in the Supabase dashboard:

1. **Authentication → URL configuration:** set *Site URL* to your app URL (`http://localhost:3000` locally) and add `http://localhost:3000/auth/callback` to *Redirect URLs*.
2. **Authentication → Emails:** keep *Confirm email* on for production. For production also configure custom SMTP so verification and reset emails come from your domain.

### 3. Web app

```bash
npm install
cp .env.example .env.local      # fill in the values; see the comments in the file
openssl rand -base64 32         # use the output for APP_ENCRYPTION_KEY
npm run dev                     # http://localhost:3000
```

If required variables are missing, every page redirects to `/setup`, which lists what is configured.

### 4. Worker

```bash
cd worker
uv sync
cp .env.example .env            # DATABASE_URL = Supabase "Session pooler" connection string
uv run python -m capflow_worker.loop                                   # no Redis needed
# or, with Redis:
uv run celery -A capflow_worker.tasks worker --beat --loglevel=INFO
uv run uvicorn capflow_worker.api:app --port 8000                      # health endpoint
```

Without `RESEND_API_KEY`/`EMAIL_FROM` the worker runs in **sandbox mode**: reminders are recorded in the communication log, clearly marked *Sandbox (not delivered)*, and never reported as sent.

---

## Tests and checks

```bash
npm run typecheck        # strict TypeScript
npm run lint             # ESLint (Next.js + React Compiler rules)
npm test                 # Vitest: money maths, CSV, webhooks signatures, billing mapping, insights, crypto
npm run test:db          # Pytest against a throwaway Postgres: RLS, tenant isolation, financial rules, recovery engine
npm run test:e2e         # Playwright: public pages always; full invoice→payment journey with E2E_SUPABASE=1

cd worker && uv run ruff check . && uv run mypy capflow_worker
```

`npm run test:db` needs a local PostgreSQL superuser (`PGHOST`, `PGUSER`, `PGPASSWORD`). `scripts/db-reset-local.sh` creates a database `capflow_test`, applies a small shim that stands in for Supabase's `auth` and `storage` schemas (`supabase/tests/local_shim.sql`, never applied to a real project), then applies every migration.

Current results: 31 Vitest tests, 82 Pytest tests (database + worker), 10 Playwright public-page tests — all passing. The authenticated Playwright journey is written but needs a Supabase backend to run.

## Repository layout

```
src/app/(auth)/          sign-in, sign-up, password reset
src/app/(app)/           the product: dashboard, invoices, customers, payments, recovery,
                         automations, analytics, communications, team, integrations, billing, settings
src/app/api/             provider webhooks, CSV/JSON exports, health check
src/lib/                 money maths, auth context, billing adapters, webhook verification, insights
supabase/migrations/     schema, triggers, RLS, analytics functions, storage, plans
worker/capflow_worker/   planner, dispatcher, AI layer, delivery adapters, job queue, Celery, API
worker/tests/            database and worker tests
e2e/                     Playwright specs
docs/                    architecture, user guide, deployment, progress
```
