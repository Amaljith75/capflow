-- Capflow · 0007 · service-role functions for billing and messaging webhooks
-- Only the service role may execute these. Webhook handlers verify provider
-- signatures before calling them.

create or replace function public.apply_subscription_update(
  p_org uuid, p_plan text, p_status public.subscription_status, p_interval text, p_provider text,
  p_customer text, p_subscription text, p_period_start timestamptz, p_period_end timestamptz, p_cancel_at_end boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare old public.subscriptions;
begin
  if not exists (select 1 from public.organisations where id = p_org) then
    perform app.fail('not_found', 'Unknown organisation.');
  end if;
  if p_plan is not null and not exists (select 1 from public.subscription_plans where id = p_plan) then
    perform app.fail('not_found', 'Unknown plan.');
  end if;
  select * into old from public.subscriptions where organisation_id = p_org for update;

  insert into public.subscriptions (organisation_id, plan_id, status, billing_interval, provider, provider_customer_id,
    provider_subscription_id, current_period_start, current_period_end, cancel_at_period_end, trial_ends_at)
  values (p_org, coalesce(p_plan, 'starter'), p_status, p_interval, p_provider, p_customer, p_subscription,
    p_period_start, p_period_end, coalesce(p_cancel_at_end, false), null)
  on conflict (organisation_id) do update set
    plan_id = coalesce(p_plan, public.subscriptions.plan_id),
    status = p_status,
    billing_interval = coalesce(p_interval, public.subscriptions.billing_interval),
    provider = coalesce(p_provider, public.subscriptions.provider),
    provider_customer_id = coalesce(p_customer, public.subscriptions.provider_customer_id),
    provider_subscription_id = coalesce(p_subscription, public.subscriptions.provider_subscription_id),
    current_period_start = coalesce(p_period_start, public.subscriptions.current_period_start),
    current_period_end = coalesce(p_period_end, public.subscriptions.current_period_end),
    cancel_at_period_end = coalesce(p_cancel_at_end, public.subscriptions.cancel_at_period_end),
    trial_ends_at = case when p_status = 'trialing' then public.subscriptions.trial_ends_at else null end;

  perform app.audit(p_org, 'subscription.' || p_status, 'subscription', p_org, null, null,
    jsonb_build_object('plan_id', coalesce(p_plan, old.plan_id), 'from_status', old.status, 'provider', p_provider));
  if p_status = 'past_due' and old.status is distinct from 'past_due' then
    perform app.notify_roles(p_org, 'owner', 'billing', 'Your Capflow payment failed',
      'Update your payment method to keep automation running.', '/billing');
  end if;
end $$;

-- Delivery status from email/SMS/WhatsApp provider webhooks. Status only moves forward.
create or replace function public.apply_delivery_status(p_provider text, p_message_id text, p_status text, p_error text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  log public.communication_logs;
  rank_old integer;
  rank_new integer;
  ranks constant jsonb := '{"queued":0,"sandbox":0,"sent":1,"delivered":2,"opened":3,"failed":4,"bounced":4,"complained":5}';
begin
  select * into log from public.communication_logs where provider = p_provider and provider_message_id = p_message_id for update;
  if not found then return false; end if;
  rank_old := coalesce((ranks ->> log.status)::integer, 0);
  rank_new := coalesce((ranks ->> p_status)::integer, -1);
  if rank_new <= rank_old then return true; end if;
  update public.communication_logs set status = p_status, error = coalesce(p_error, error) where id = log.id;

  if p_status in ('bounced', 'failed') and log.reminder_id is not null then
    perform app.set_internal(true);
    update public.reminders set status = 'failed', last_error = coalesce(p_error, 'Provider reported ' || p_status)
      where id = log.reminder_id and status = 'sent';
    perform app.set_internal(false);
  end if;
  -- A spam complaint is treated as an email opt-out.
  if p_status = 'complained' and log.customer_id is not null then
    update public.customers set email_opt_out = true where id = log.customer_id;
    perform app.audit(log.organisation_id, 'customer.opted_out', 'customer', log.customer_id, null, log.customer_id,
      jsonb_build_object('channel', log.channel, 'source', 'complaint'));
  end if;
  return true;
end $$;

create or replace function public.record_opt_out(p_customer uuid, p_channel text, p_source text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare c public.customers;
begin
  select * into c from public.customers where id = p_customer for update;
  if not found then return false; end if;
  if p_channel = 'email' then update public.customers set email_opt_out = true where id = p_customer;
  elsif p_channel = 'whatsapp' then update public.customers set whatsapp_opt_in = false where id = p_customer;
  elsif p_channel = 'sms' then update public.customers set sms_opt_in = false where id = p_customer;
  else return false; end if;
  perform app.audit(c.organisation_id, 'customer.opted_out', 'customer', p_customer, null, p_customer,
    jsonb_build_object('channel', p_channel, 'source', p_source));
  return true;
end $$;

-- Finds the customer for an inbound "STOP" over SMS/WhatsApp by phone number (digits compared).
create or replace function public.opt_out_by_phone(p_phone text, p_channel text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_digits text := regexp_replace(p_phone, '\D', '', 'g');
  r record;
  n integer := 0;
begin
  if length(v_digits) < 6 then return 0; end if;
  for r in select id from public.customers
    where regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_digits
       or right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = right(v_digits, 10) and length(v_digits) >= 10
  loop
    perform public.record_opt_out(r.id, p_channel, 'inbound_stop');
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.apply_subscription_update(uuid, text, public.subscription_status, text, text, text, text, timestamptz, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.apply_delivery_status(text, text, text, text) from public, anon, authenticated;
revoke all on function public.record_opt_out(uuid, text, text) from public, anon, authenticated;
revoke all on function public.opt_out_by_phone(text, text) from public, anon, authenticated;
grant execute on function public.apply_subscription_update(uuid, text, public.subscription_status, text, text, text, text, timestamptz, timestamptz, boolean) to service_role;
grant execute on function public.apply_delivery_status(text, text, text, text) to service_role;
grant execute on function public.record_opt_out(uuid, text, text) to service_role;
grant execute on function public.opt_out_by_phone(text, text) to service_role;
