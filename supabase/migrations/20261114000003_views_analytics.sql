-- Capflow · 0003 · reporting views and analytics functions
-- All views use security_invoker and all functions are SECURITY INVOKER, so RLS
-- on the underlying tables scopes every result to the caller's organisations.
-- Amounts are never converted between currencies: every aggregate is per currency.

create view public.invoice_ledger with (security_invoker = true) as
select
  i.*,
  c.name as customer_name,
  c.email as customer_email,
  t.today,
  (i.status in ('sent', 'partially_paid', 'disputed') and i.archived_at is null) as is_open,
  case when i.status in ('sent', 'partially_paid', 'disputed') then greatest(0, t.today - i.due_date) else 0 end as days_overdue,
  case when i.status = 'sent' and i.due_date < t.today then 'overdue' else i.status::text end as effective_status,
  case
    when i.status not in ('sent', 'partially_paid', 'disputed') then null
    when t.today - i.due_date <= 0 then 'not_due'
    when t.today - i.due_date <= 30 then '1_30'
    when t.today - i.due_date <= 60 then '31_60'
    when t.today - i.due_date <= 90 then '61_90'
    else '90_plus'
  end as ageing_bucket
from public.invoices i
join public.customers c on c.id = i.customer_id
join public.organisations o on o.id = i.organisation_id
cross join lateral (select (now() at time zone o.timezone)::date as today) t;

-- Per-customer receivables position and a transparent, rule-based risk score.
-- The score is deterministic (no AI) so it can be explained to the user:
--   oldest overdue invoice  >90d: 40 · >60d: 30 · >30d: 20 · >0d: 10
--   average days late       >30: 25 · >14: 15 · >7: 8
--   broken promises         10 each, capped at 20
--   overdue share of balance >75%: 15 · >40%: 8
--   high >= 50 · medium >= 25 · low otherwise
create view public.customer_stats with (security_invoker = true) as
with agg as (
  select
    l.organisation_id, l.customer_id, l.currency,
    count(*) as invoice_count,
    count(*) filter (where l.is_open) as open_invoice_count,
    count(*) filter (where l.is_open and l.days_overdue > 0) as overdue_invoice_count,
    count(*) filter (where l.is_open and l.days_overdue > 30) as overdue_30_plus_count,
    sum(l.total) as total_invoiced,
    sum(l.amount_paid) as total_paid,
    coalesce(sum(l.amount_outstanding) filter (where l.is_open), 0) as outstanding,
    coalesce(sum(l.amount_outstanding) filter (where l.is_open and l.days_overdue > 0), 0) as overdue,
    coalesce(max(l.days_overdue) filter (where l.is_open), 0) as max_days_overdue,
    round(avg(greatest(0, l.paid_on - l.due_date)) filter (where l.status = 'paid'), 1) as avg_days_late,
    round(avg(greatest(0, l.paid_on - l.due_date)) filter (where l.status = 'paid' and l.paid_on >= l.today - 90), 1) as recent_avg_days_late,
    count(*) filter (where l.status = 'paid' and l.paid_on >= l.today - 90) as recent_paid_count,
    round(avg(greatest(0, l.paid_on - l.due_date)) filter (where l.status = 'paid' and l.paid_on < l.today - 90 and l.paid_on >= l.today - 180), 1) as prior_avg_days_late,
    count(*) filter (where l.status = 'paid' and l.paid_on < l.today - 90 and l.paid_on >= l.today - 180) as prior_paid_count,
    max(l.paid_on) as last_paid_on
  from public.invoice_ledger l
  where l.status not in ('draft', 'cancelled') and l.archived_at is null
  group by l.organisation_id, l.customer_id, l.currency
),
prom as (
  select customer_id,
    count(*) filter (where status = 'broken') as broken_promises,
    count(*) filter (where status = 'pending') as pending_promises
  from public.payment_promises group by customer_id
),
scored as (
  select a.*, coalesce(p.broken_promises, 0) as broken_promises, coalesce(p.pending_promises, 0) as pending_promises,
    (case when a.max_days_overdue > 90 then 40 when a.max_days_overdue > 60 then 30
          when a.max_days_overdue > 30 then 20 when a.max_days_overdue > 0 then 10 else 0 end
     + case when a.avg_days_late > 30 then 25 when a.avg_days_late > 14 then 15 when a.avg_days_late > 7 then 8 else 0 end
     + least(20, 10 * coalesce(p.broken_promises, 0))
     + case when a.outstanding > 0 and a.overdue / a.outstanding > 0.75 then 15
            when a.outstanding > 0 and a.overdue / a.outstanding > 0.4 then 8 else 0 end)::integer as risk_score
  from agg a left join prom p on p.customer_id = a.customer_id
)
select s.*, c.name as customer_name, c.email as customer_email,
  case when s.risk_score >= 50 then 'high' when s.risk_score >= 25 then 'medium' else 'low' end as risk_level
from scored s join public.customers c on c.id = s.customer_id;

create or replace function public.dashboard_summary(p_org uuid, p_currency text) returns jsonb
language sql stable set search_path = '' as $$
  with l as (
    select * from public.invoice_ledger
    where organisation_id = p_org and currency = p_currency and archived_at is null and status not in ('draft', 'cancelled')
  ),
  today as (select (now() at time zone o.timezone)::date as d from public.organisations o where o.id = p_org),
  collected as (
    select
      coalesce(sum(a.amount), 0) as total,
      coalesce(sum(a.amount) filter (where p.payment_date > i.due_date), 0) as past_due
    from public.payment_allocations a
    join public.payments p on p.id = a.payment_id
    join public.invoices i on i.id = a.invoice_id
    where a.organisation_id = p_org and p.currency = p_currency and p.voided_at is null
      and p.payment_date >= date_trunc('month', (select d from today))::date
  ),
  recent as (
    select coalesce(sum(total), 0) as invoiced, coalesce(sum(amount_paid), 0) as paid
    from l where issue_date >= (select d from today) - 90
  )
  select jsonb_build_object(
    'currency', p_currency,
    'today', (select d from today),
    'outstanding', coalesce((select sum(amount_outstanding) from l where is_open), 0),
    'outstanding_count', (select count(*) from l where is_open),
    'overdue', coalesce((select sum(amount_outstanding) from l where is_open and days_overdue > 0), 0),
    'overdue_count', (select count(*) from l where is_open and days_overdue > 0),
    'due_this_week', coalesce((select sum(amount_outstanding) from l
        where is_open and due_date between (select d from today) and (select d from today) + 6), 0),
    'due_this_week_count', (select count(*) from l
        where is_open and due_date between (select d from today) and (select d from today) + 6),
    'recovered_this_month', (select total from collected),
    'recovered_past_due_this_month', (select past_due from collected),
    'collection_rate_90d', (select case when invoiced > 0 then round(paid / invoiced * 100, 1) end from recent),
    'avg_days_to_pay', (select round(avg(paid_on - issue_date), 1) from l
        where status = 'paid' and paid_on >= (select d from today) - 180),
    'disputed_count', (select count(*) from l where status = 'disputed'),
    'ageing', (select coalesce(jsonb_object_agg(bucket, jsonb_build_object('amount', amount, 'count', n)), '{}'::jsonb)
      from (select ageing_bucket as bucket, sum(amount_outstanding) as amount, count(*) as n
            from l where is_open group by ageing_bucket) b)
  )
$$;

-- Monthly invoiced / collected and the receivables balance at each month end.
create or replace function public.cashflow_trend(p_org uuid, p_currency text, p_months integer default 6)
returns table (month date, invoiced numeric, collected numeric, outstanding_end numeric)
language sql stable set search_path = '' as $$
  with today as (select (now() at time zone o.timezone)::date as d from public.organisations o where o.id = p_org),
  months as (
    select generate_series(
      date_trunc('month', (select d from today)) - make_interval(months => least(greatest(p_months, 1), 36) - 1),
      date_trunc('month', (select d from today)), interval '1 month')::date as m
  ),
  inv as (
    select issue_date, total from public.invoices
    where organisation_id = p_org and currency = p_currency and status not in ('draft', 'cancelled') and archived_at is null
  ),
  pay as (
    select p.payment_date, a.amount
    from public.payment_allocations a join public.payments p on p.id = a.payment_id
    join public.invoices i on i.id = a.invoice_id
    where a.organisation_id = p_org and p.currency = p_currency and p.voided_at is null
      and i.status <> 'cancelled' and i.archived_at is null
  )
  select m.m,
    coalesce((select sum(total) from inv where issue_date >= m.m and issue_date < (m.m + interval '1 month')), 0),
    coalesce((select sum(amount) from pay where payment_date >= m.m and payment_date < (m.m + interval '1 month')), 0),
    coalesce((select sum(total) from inv where issue_date < (m.m + interval '1 month')), 0)
      - coalesce((select sum(amount) from pay where payment_date < (m.m + interval '1 month')), 0)
  from months m order by m.m
$$;

-- Collections KPIs for a period. Formulas (shown in the UI next to each number):
--   DSO = ending receivables / invoiced in period * days in period
--   CEI = (beginning AR + invoiced - ending AR) / (beginning AR + invoiced - ending current AR) * 100
create or replace function public.collection_metrics(p_org uuid, p_currency text, p_from date, p_to date) returns jsonb
language sql stable set search_path = '' as $$
  with inv as (
    select i.id, i.issue_date, i.due_date, i.total, i.status, i.paid_on
    from public.invoices i
    where i.organisation_id = p_org and i.currency = p_currency
      and i.status not in ('draft', 'cancelled') and i.archived_at is null
  ),
  pay as (
    select a.invoice_id, a.amount, p.payment_date
    from public.payment_allocations a join public.payments p on p.id = a.payment_id
    join inv on inv.id = a.invoice_id
    where p.voided_at is null
  ),
  bal as (
    select inv.id, inv.due_date,
      case when inv.issue_date < p_from
        then inv.total - coalesce((select sum(amount) from pay where invoice_id = inv.id and payment_date < p_from), 0) else 0 end as opening,
      case when inv.issue_date <= p_to
        then inv.total - coalesce((select sum(amount) from pay where invoice_id = inv.id and payment_date <= p_to), 0) else 0 end as closing
    from inv
  ),
  t as (
    select
      coalesce((select sum(total) from inv where issue_date between p_from and p_to), 0) as invoiced,
      coalesce((select sum(amount) from pay where payment_date between p_from and p_to), 0) as collected,
      coalesce((select sum(opening) from bal), 0) as beginning_ar,
      coalesce((select sum(closing) from bal), 0) as ending_ar,
      coalesce((select sum(closing) from bal where due_date >= p_to), 0) as ending_current_ar,
      (p_to - p_from + 1) as days
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'currency', p_currency,
    'invoiced', t.invoiced, 'collected', t.collected,
    'beginning_ar', t.beginning_ar, 'ending_ar', t.ending_ar, 'ending_current_ar', t.ending_current_ar,
    'recovery_rate', case when t.beginning_ar + t.invoiced > 0
      then round(t.collected / (t.beginning_ar + t.invoiced) * 100, 1) end,
    'dso', case when t.invoiced > 0 then round(t.ending_ar / t.invoiced * t.days, 1) end,
    'cei', case when (t.beginning_ar + t.invoiced - t.ending_current_ar) > 0
      then round((t.beginning_ar + t.invoiced - t.ending_ar) / (t.beginning_ar + t.invoiced - t.ending_current_ar) * 100, 1) end,
    'avg_collection_days', (select round(avg(paid_on - issue_date), 1) from inv
        where status = 'paid' and paid_on between p_from and p_to),
    'invoices_paid', (select count(*) from inv where status = 'paid' and paid_on between p_from and p_to),
    'promises_made', (select count(*) from public.payment_promises
        where organisation_id = p_org and created_at::date between p_from and p_to),
    'promises_fulfilled', (select count(*) from public.payment_promises
        where organisation_id = p_org and status = 'fulfilled' and resolved_at::date between p_from and p_to),
    'promises_broken', (select count(*) from public.payment_promises
        where organisation_id = p_org and status = 'broken' and resolved_at::date between p_from and p_to)
  ) from t
$$;

-- For each reminder stage: how many were sent and how many were followed by a
-- recorded payment on the same invoice within 7 days. Correlation, not proof of cause.
create or replace function public.reminder_performance(p_org uuid, p_from date, p_to date)
returns table (stage text, tone text, channel text, sent bigint, paid_within_7d bigint, failed bigint)
language sql stable set search_path = '' as $$
  select r.stage, r.tone::text, r.channel::text,
    count(*) filter (where r.status = 'sent'),
    count(*) filter (where r.status = 'sent' and exists (
      select 1 from public.payment_allocations a join public.payments p on p.id = a.payment_id
      where a.invoice_id = r.invoice_id and p.voided_at is null
        and p.payment_date between r.sent_at::date and r.sent_at::date + 7)),
    count(*) filter (where r.status = 'failed')
  from public.reminders r
  where r.organisation_id = p_org and r.created_at::date between p_from and p_to
    and r.status in ('sent', 'failed')
  group by r.stage, r.tone, r.channel
  order by min(r.step_offset_days) nulls last, r.stage
$$;

create or replace function public.currencies_in_use(p_org uuid) returns table (currency text, invoice_count bigint)
language sql stable set search_path = '' as $$
  select currency, count(*) from public.invoices
  where organisation_id = p_org and archived_at is null group by currency order by count(*) desc
$$;
