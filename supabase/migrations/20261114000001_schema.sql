-- Capflow · 0001 · core schema
-- Multi-tenant accounts-receivable schema. Every organisation-owned row carries
-- organisation_id; access is enforced by RLS in migration 0003.

create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.org_role as enum ('viewer', 'accountant', 'finance_manager', 'admin', 'owner');
-- 'overdue' is never stored: it is derived from due_date in the invoice_ledger view.
create type public.invoice_status as enum ('draft', 'sent', 'partially_paid', 'paid', 'overdue', 'disputed', 'cancelled');
create type public.promise_status as enum ('pending', 'fulfilled', 'broken', 'cancelled');
create type public.reminder_status as enum ('pending_approval', 'scheduled', 'sending', 'sent', 'failed', 'cancelled', 'skipped');
create type public.workflow_status as enum ('active', 'paused', 'awaiting_promise', 'escalated', 'human_review', 'completed', 'stopped');
create type public.comm_channel as enum ('email', 'whatsapp', 'sms');
create type public.message_tone as enum ('friendly', 'professional', 'firm', 'final');
create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'cancelled', 'expired');
create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed', 'dead');

-- ---------------------------------------------------------------------------
-- Identity & tenancy
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique,
  legal_name text,
  tax_id text,
  billing_email text,
  address text,
  country text not null default 'IN' check (char_length(country) = 2),
  base_currency text not null default 'INR' check (base_currency ~ '^[A-Z]{3}$'),
  timezone text not null default 'Asia/Kolkata',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.organisation_members (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null default 'viewer',
  created_at timestamptz not null default now(),
  unique (organisation_id, user_id)
);
create index organisation_members_user_idx on public.organisation_members (user_id);

create table public.organisation_invitations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  email text not null,
  role public.org_role not null default 'viewer' check (role <> 'owner'),
  token_hash text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index organisation_invitations_org_idx on public.organisation_invitations (organisation_id);

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  email text,
  phone text,
  billing_address text,
  tax_id text,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  payment_terms_days integer not null default 30 check (payment_terms_days between 0 and 365),
  notes text,
  -- consent / opt-out tracking per channel
  email_opt_out boolean not null default false,
  whatsapp_opt_in boolean not null default false,
  sms_opt_in boolean not null default false,
  consent_updated_at timestamptz,
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_org_idx on public.customers (organisation_id) where archived_at is null;
create index customers_org_name_idx on public.customers (organisation_id, lower(name));

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete restrict,
  invoice_number text not null check (char_length(invoice_number) between 1 and 60),
  issue_date date not null,
  due_date date not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  -- Totals are maintained by triggers from invoice_items / payment_allocations.
  subtotal numeric(14, 2) not null default 0 check (subtotal >= 0),
  tax_total numeric(14, 2) not null default 0 check (tax_total >= 0),
  total numeric(14, 2) not null default 0 check (total >= 0),
  amount_paid numeric(14, 2) not null default 0 check (amount_paid >= 0),
  amount_outstanding numeric(14, 2) generated always as (total - amount_paid) stored,
  status public.invoice_status not null default 'draft' check (status <> 'overdue'),
  status_before_dispute public.invoice_status,
  notes text,
  payment_reference text,
  attachment_path text,
  attachment_name text,
  recovery_paused boolean not null default false,
  dispute_reason text,
  disputed_at timestamptz,
  sent_at timestamptz,
  paid_on date,
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_due_after_issue check (due_date >= issue_date),
  constraint invoices_paid_not_above_total check (amount_paid <= total),
  unique (organisation_id, invoice_number)
);
create index invoices_org_status_idx on public.invoices (organisation_id, status) where archived_at is null;
create index invoices_org_due_idx on public.invoices (organisation_id, due_date) where archived_at is null;
create index invoices_customer_idx on public.invoices (customer_id);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  position integer not null default 0,
  description text not null check (char_length(description) between 1 and 500),
  quantity numeric(12, 3) not null default 1 check (quantity > 0),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  -- If tax_rate is set, tax_amount is derived from it; otherwise tax_amount is explicit (imports).
  tax_rate numeric(7, 4) check (tax_rate is null or (tax_rate >= 0 and tax_rate <= 100)),
  tax_amount numeric(14, 2) not null default 0 check (tax_amount >= 0),
  line_subtotal numeric(14, 2) not null default 0,
  line_total numeric(14, 2) not null default 0,
  created_at timestamptz not null default now()
);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id);

-- ---------------------------------------------------------------------------
-- Payments (immutable ledger; corrections happen by voiding)
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  payment_date date not null,
  method text not null default 'bank_transfer'
    check (method in ('bank_transfer', 'upi', 'card', 'cash', 'cheque', 'other')),
  reference text,
  notes text,
  source text not null default 'manual' check (source in ('manual', 'csv_import')),
  idempotency_key text not null,
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  void_reason text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organisation_id, idempotency_key)
);
create index payments_org_date_idx on public.payments (organisation_id, payment_date desc);
create index payments_customer_idx on public.payments (customer_id);
create index payments_dupe_idx on public.payments (organisation_id, customer_id, amount, payment_date);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  payment_id uuid not null references public.payments (id) on delete restrict,
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (payment_id, invoice_id)
);
create index payment_allocations_invoice_idx on public.payment_allocations (invoice_id);

create table public.payment_promises (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  promised_amount numeric(14, 2) not null check (promised_amount > 0),
  promised_date date not null,
  status public.promise_status not null default 'pending',
  notes text,
  follow_up_date date,
  -- amount_paid on the invoice when the promise was made; fulfilment is measured from here
  baseline_amount_paid numeric(14, 2) not null default 0,
  resolved_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payment_promises_org_status_idx on public.payment_promises (organisation_id, status, promised_date);
create unique index payment_promises_one_pending_idx on public.payment_promises (invoice_id) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Recovery automation
-- ---------------------------------------------------------------------------
create table public.communication_templates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  name text not null,
  channel public.comm_channel not null default 'email',
  tone public.message_tone not null default 'professional',
  subject text,
  body text not null check (char_length(body) between 10 and 5000),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index communication_templates_org_idx on public.communication_templates (organisation_id);

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  is_active boolean not null default true,
  -- 'manual': every message waits for human approval. 'auto': sent without approval.
  approval_mode text not null default 'manual' check (approval_mode in ('manual', 'auto')),
  use_ai boolean not null default false,
  working_hours_start time not null default '09:00',
  working_hours_end time not null default '18:00',
  working_days smallint[] not null default '{1,2,3,4,5}', -- ISO weekday numbers
  max_attempts integer not null default 6 check (max_attempts between 1 and 30),
  min_hours_between integer not null default 24 check (min_hours_between between 1 and 720),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint working_hours_order check (working_hours_end > working_hours_start)
);
create unique index automation_rules_one_default_idx on public.automation_rules (organisation_id) where is_default;

create table public.automation_rule_steps (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  rule_id uuid not null references public.automation_rules (id) on delete cascade,
  -- days relative to the invoice due date; negative = before due
  offset_days integer not null check (offset_days between -60 and 365),
  stage text not null,
  action text not null default 'send' check (action in ('send', 'escalate')),
  channel public.comm_channel not null default 'email',
  tone public.message_tone not null default 'professional',
  template_id uuid references public.communication_templates (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (rule_id, offset_days)
);

create table public.recovery_workflows (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  invoice_id uuid not null unique references public.invoices (id) on delete cascade,
  rule_id uuid references public.automation_rules (id) on delete set null,
  status public.workflow_status not null default 'active',
  status_reason text,
  attempts_count integer not null default 0,
  last_action_at timestamptz,
  escalated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recovery_workflows_org_status_idx on public.recovery_workflows (organisation_id, status);

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  workflow_id uuid references public.recovery_workflows (id) on delete set null,
  step_id uuid references public.automation_rule_steps (id) on delete set null,
  step_offset_days integer,
  stage text not null,
  channel public.comm_channel not null default 'email',
  tone public.message_tone not null default 'professional',
  subject text,
  body text not null,
  generated_by text not null default 'template' check (generated_by in ('template', 'ai', 'manual')),
  ai_model text,
  status public.reminder_status not null default 'pending_approval',
  scheduled_for timestamptz not null default now(),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  -- guarantees a step can only ever produce one reminder per invoice
  dedupe_key text not null unique,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reminders_org_status_idx on public.reminders (organisation_id, status);
create index reminders_due_idx on public.reminders (scheduled_for) where status = 'scheduled';
create index reminders_invoice_idx on public.reminders (invoice_id);

create table public.communication_logs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  invoice_id uuid references public.invoices (id) on delete set null,
  reminder_id uuid references public.reminders (id) on delete set null,
  channel public.comm_channel not null,
  provider text not null,
  -- true when no live provider was configured: the message was NOT delivered to anyone
  sandbox boolean not null default false,
  provider_message_id text,
  to_address text not null,
  subject text,
  body text not null,
  status text not null default 'queued'
    check (status in ('queued', 'sandbox', 'sent', 'delivered', 'opened', 'bounced', 'complained', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index communication_logs_org_idx on public.communication_logs (organisation_id, created_at desc);
create index communication_logs_customer_idx on public.communication_logs (customer_id);
create unique index communication_logs_provider_msg_idx
  on public.communication_logs (provider, provider_message_id) where provider_message_id is not null;

-- ---------------------------------------------------------------------------
-- Integrations (non-secret settings are tenant-readable; secrets are service-role only)
-- ---------------------------------------------------------------------------
create table public.integration_configs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  kind text not null check (kind in ('email', 'whatsapp', 'sms', 'ai')),
  enabled boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  has_secret boolean not null default false,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, kind)
);

create table public.integration_secrets (
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  kind text not null,
  -- AES-256-GCM ciphertext (base64: iv || tag || data), key held only by server processes
  ciphertext text not null,
  updated_at timestamptz not null default now(),
  primary key (organisation_id, kind)
);

-- ---------------------------------------------------------------------------
-- SaaS billing
-- ---------------------------------------------------------------------------
create table public.subscription_plans (
  id text primary key,
  name text not null,
  description text not null,
  sort_order integer not null default 0,
  is_public boolean not null default true,
  -- { "INR": { "monthly": 49900, "annual": 499000 }, ... } in minor units; null = custom pricing
  prices jsonb,
  -- { "max_users": 1, "max_invoices_per_month": 50, "ai_reminders": false, ... }; null limit = unlimited
  entitlements jsonb not null,
  -- { "stripe": { "monthly": "price_...", "annual": "price_..." }, "razorpay": { ... } }
  provider_price_ids jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null unique references public.organisations (id) on delete cascade,
  plan_id text not null references public.subscription_plans (id),
  status public.subscription_status not null default 'trialing',
  billing_interval text check (billing_interval in ('monthly', 'annual')),
  provider text check (provider in ('stripe', 'razorpay')),
  provider_customer_id text,
  provider_subscription_id text,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index subscriptions_provider_sub_idx
  on public.subscriptions (provider, provider_subscription_id) where provider_subscription_id is not null;

create table public.billing_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text not null,
  organisation_id uuid references public.organisations (id) on delete set null,
  payload jsonb not null,
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (provider, event_id)
);

-- ---------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  actor_type text not null default 'user' check (actor_type in ('user', 'system')),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  invoice_id uuid references public.invoices (id) on delete set null,
  customer_id uuid references public.customers (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_org_idx on public.audit_logs (organisation_id, created_at desc);
create index audit_logs_invoice_idx on public.audit_logs (invoice_id, created_at desc);

create table public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations (id) on delete cascade,
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status public.job_status not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  finished_at timestamptz,
  last_error text,
  result jsonb,
  idempotency_key text unique,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index background_jobs_queue_idx on public.background_jobs (run_at) where status = 'queued';
create index background_jobs_org_idx on public.background_jobs (organisation_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, organisation_id, created_at desc);

create table public.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 1,
  primary key (bucket, window_start)
);
