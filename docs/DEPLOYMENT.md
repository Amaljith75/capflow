# Deploying Capflow

## 1. Supabase
1. Create a project (choose a region close to your customers; Mumbai for India).
2. Apply `supabase/migrations/*` in order (`supabase db push`).
3. Auth → URL configuration: Site URL `https://app.yourdomain.com`; redirect URL `https://app.yourdomain.com/auth/callback`.
4. Auth → SMTP: configure your email provider so verification and reset emails come from your domain.
5. Enable Point-in-Time Recovery (Pro plan) for financial data. Daily backups are included on paid plans.
6. Retention purge (optional, after legal review): schedule with `pg_cron` a job that hard-deletes organisations whose `deleted_at` is older than your retention period.

## 2. Web app on Vercel
1. Import the repository. Framework preset: Next.js.
2. Environment variables (Production): everything in `.env.example`. `SUPABASE_SERVICE_ROLE_KEY`, `APP_ENCRYPTION_KEY` and provider secrets must **not** have the `NEXT_PUBLIC_` prefix.
3. `NEXT_PUBLIC_APP_URL` = your production URL.
4. Health check: `GET /api/health` returns 200 when the database is reachable.

## 3. Worker on Railway / Render / Fly
Build from `worker/Dockerfile`. Run two processes:

| Process | Command |
| --- | --- |
| worker (+ beat) | default `CMD` (Celery worker with embedded beat). Run exactly one beat. |
| api (optional) | `uvicorn capflow_worker.api:app --host 0.0.0.0 --port $PORT` — health check path `/health` |

Variables: see `worker/.env.example`. `DATABASE_URL` is Supabase's **Session pooler** string (port 5432). `APP_ENCRYPTION_KEY` must match the web app. Add a managed Redis (Railway Redis, Upstash, Render Key Value) and set `REDIS_URL`.

Small deployments can skip Redis: run `python -m capflow_worker.loop` as the only process.

## 4. Providers
| Provider | Configure | Webhook URL |
| --- | --- | --- |
| Resend | Verify your sending domain; `RESEND_API_KEY`, `EMAIL_FROM` on web **and** worker | `/api/webhooks/resend` (events: sent, delivered, opened, bounced, complained) → `RESEND_WEBHOOK_SECRET` |
| Stripe | Create a Product + monthly/annual Prices per plan; put the price ids in `subscription_plans.provider_price_ids` as `{"stripe": {"monthly": "price_…", "annual": "price_…"}}`; enable the customer portal | `/api/webhooks/stripe` (checkout.session.completed, customer.subscription.*) → `STRIPE_WEBHOOK_SECRET` |
| Razorpay | Create Plans; put plan ids under `"razorpay"` in `provider_price_ids` | `/api/webhooks/razorpay` (subscription.*) → `RAZORPAY_WEBHOOK_SECRET` |
| WhatsApp Cloud API | Meta Business verification, an approved template with 4 body variables (customer, invoice, amount, due date); tenants enter their token in Integrations | `/api/webhooks/whatsapp`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` |
| Twilio | Tenants enter Account SID / token / number | `/api/webhooks/twilio`, `TWILIO_AUTH_TOKEN` |

Prices and entitlements are rows in `subscription_plans`; change them with SQL, no deploy needed.

## 5. CI/CD
`.github/workflows/ci.yml` runs typecheck, lint, unit tests, build, the Postgres-backed test suite and the worker's ruff/mypy on every push. Recommended: Vercel preview deployments per PR, Supabase branching for migration previews, and migrations applied by `supabase db push` in a protected deploy job before the web deploy.

## 6. Monitoring
- Web: Vercel logs; add Sentry (`@sentry/nextjs`) for error reporting.
- Worker: JSON logs to stdout (ship to your log platform); `/health` for uptime checks; `/status` (with `WORKER_ADMIN_TOKEN`) shows queue depths, failures and reminders past their send time.
- The Recovery page warns users when scheduled reminders are more than 15 minutes late, which indicates the worker is down.
