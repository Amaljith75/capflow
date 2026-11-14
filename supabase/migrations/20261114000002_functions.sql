-- Capflow · 0002 · functions and triggers
--
-- Conventions
--  * Helpers live in schema `app`, which is not exposed through the REST API.
--  * auth.uid() IS NULL means a trusted system context (worker / service role).
--  * Columns that only the system may change (totals, balances, paid status, promise outcome)
--    are protected by guard triggers; internal functions open the guard with the
--    transaction-local setting app.internal_write = 'on'.
--  * User-facing errors are raised as 'CAPFLOW:<code>:<message>'.

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function app.fail(p_code text, p_message text) returns void
language plpgsql as $$
begin
  raise exception 'CAPFLOW:%:%', p_code, p_message using errcode = 'P0001';
end $$;

create or replace function app.internal() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.internal_write', true), '') = 'on'
$$;

create or replace function app.set_internal(p_on boolean) returns void
language sql as $$
  select set_config('app.internal_write', case when p_on then 'on' else 'off' end, true)
$$;

create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function app.role_rank(p_role public.org_role) returns integer
language sql immutable as $$
  select case p_role
    when 'viewer' then 1 when 'accountant' then 2 when 'finance_manager' then 3
    when 'admin' then 4 when 'owner' then 5 end
$$;

create or replace function app.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organisation_members m
    join public.organisations o on o.id = m.organisation_id
    where m.organisation_id = p_org and m.user_id = auth.uid() and o.deleted_at is null
  )
$$;

create or replace function app.has_min_role(p_org uuid, p_role public.org_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organisation_members m
    join public.organisations o on o.id = m.organisation_id
    where m.organisation_id = p_org and m.user_id = auth.uid() and o.deleted_at is null
      and app.role_rank(m.role) >= app.role_rank(p_role)
  )
$$;

create or replace function app.org_today(p_org uuid) returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce((select timezone from public.organisations where id = p_org), 'UTC'))::date
$$;

create or replace function app.audit(
  p_org uuid, p_action text, p_entity_type text, p_entity_id uuid,
  p_invoice uuid default null, p_customer uuid default null, p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs (organisation_id, actor_id, actor_type, action, entity_type, entity_id, invoice_id, customer_id, metadata)
  values (p_org, auth.uid(), case when auth.uid() is null then 'system' else 'user' end,
          p_action, p_entity_type, p_entity_id, p_invoice, p_customer, coalesce(p_metadata, '{}'::jsonb));
end $$;

create or replace function app.notify_roles(
  p_org uuid, p_min_role public.org_role, p_kind text, p_title text, p_body text, p_link text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (organisation_id, user_id, kind, title, body, link)
  select p_org, m.user_id, p_kind, p_title, p_body, p_link
  from public.organisation_members m
  where m.organisation_id = p_org and app.role_rank(m.role) >= app.role_rank(p_min_role);
end $$;

-- ---------------------------------------------------------------------------
-- Entitlements (server-side plan enforcement)
-- ---------------------------------------------------------------------------
create or replace function app.entitlements(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.subscriptions;
  v_limits jsonb;
  v_active boolean;
begin
  select * into s from public.subscriptions where organisation_id = p_org;
  if not found then
    return jsonb_build_object('plan_id', null, 'status', 'none', 'active', false, 'limits', '{}'::jsonb);
  end if;
  v_active := s.status in ('active', 'past_due')
    or (s.status = 'trialing' and s.trial_ends_at > now())
    or (s.status = 'cancelled' and s.current_period_end is not null and s.current_period_end > now());
  select entitlements into v_limits from public.subscription_plans where id = s.plan_id;
  return jsonb_build_object(
    'plan_id', s.plan_id, 'status', s.status, 'active', v_active,
    'trial_ends_at', s.trial_ends_at, 'current_period_end', s.current_period_end,
    'cancel_at_period_end', s.cancel_at_period_end, 'billing_interval', s.billing_interval,
    'provider', s.provider,
    'limits', coalesce(v_limits, '{}'::jsonb));
end $$;

create or replace function app.require_active(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e jsonb := app.entitlements(p_org);
begin
  if not (e ->> 'active')::boolean then
    perform app.fail('subscription_inactive', 'Your subscription is not active. Choose a plan in Billing to continue.');
  end if;
  return e;
end $$;

create or replace function app.require_feature(p_org uuid, p_feature text, p_label text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare e jsonb := app.require_active(p_org);
begin
  if coalesce((e -> 'limits' ->> p_feature)::boolean, false) is not true then
    perform app.fail('plan_feature', p_label || ' is not included in your current plan.');
  end if;
end $$;

create or replace function app.require_under_limit(p_org uuid, p_limit text, p_current bigint, p_label text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  e jsonb := app.require_active(p_org);
  v_limit bigint := (e -> 'limits' ->> p_limit)::bigint;
begin
  if v_limit is not null and p_current >= v_limit then
    perform app.fail('plan_limit', 'Your plan allows ' || v_limit || ' ' || p_label || '. Upgrade to add more.');
  end if;
end $$;

create or replace function app.usage(p_org uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'users', (select count(*) from public.organisation_members where organisation_id = p_org),
    'invoices_this_month', (select count(*) from public.invoices
       where organisation_id = p_org and created_at >= date_trunc('month', now())),
    'reminders_this_month', (select count(*) from public.reminders
       where organisation_id = p_org and status = 'sent' and sent_at >= date_trunc('month', now())),
    'automation_rules', (select count(*) from public.automation_rules where organisation_id = p_org))
$$;

create or replace function public.org_entitlements(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not app.is_org_member(p_org) then
    perform app.fail('forbidden', 'Not a member of this organisation.');
  end if;
  return app.entitlements(p_org) || jsonb_build_object('usage', app.usage(p_org));
end $$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''), nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------------
-- Organisation bootstrap
-- ---------------------------------------------------------------------------
create or replace function app.seed_org_defaults(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_rule uuid;
  t_friendly uuid; t_professional uuid; t_firm uuid; t_final uuid;
begin
  insert into public.communication_templates (organisation_id, name, channel, tone, subject, body, is_default)
  values (p_org, 'Friendly reminder', 'email', 'friendly',
    'Upcoming payment: invoice {{invoice_number}}',
    E'Hi {{customer_name}},\n\nA quick note that invoice {{invoice_number}} for {{amount_outstanding}} is due on {{due_date}}.\n\nIf payment is already on its way, thank you and please ignore this message. If you have any questions about the invoice, just reply to this email.\n\nThanks,\n{{organisation_name}}', true)
  returning id into t_friendly;
  insert into public.communication_templates (organisation_id, name, channel, tone, subject, body, is_default)
  values (p_org, 'Professional reminder', 'email', 'professional',
    'Payment reminder: invoice {{invoice_number}}',
    E'Hello {{customer_name}},\n\nOur records show that invoice {{invoice_number}} has an outstanding balance of {{amount_outstanding}}, due on {{due_date}}.\n\nCould you let us know when we can expect payment? If you have already paid, please share the payment reference so we can update our records.\n\nRegards,\n{{organisation_name}}', true)
  returning id into t_professional;
  insert into public.communication_templates (organisation_id, name, channel, tone, subject, body, is_default)
  values (p_org, 'Firm follow-up', 'email', 'firm',
    'Overdue: invoice {{invoice_number}} ({{days_overdue}} days)',
    E'Hello {{customer_name}},\n\nInvoice {{invoice_number}} is now {{days_overdue}} days past its due date of {{due_date}}, with {{amount_outstanding}} outstanding.\n\nPlease arrange payment, or reply with the date we should expect it. If there is a problem with the invoice, tell us so we can resolve it.\n\nRegards,\n{{organisation_name}}', true)
  returning id into t_firm;
  insert into public.communication_templates (organisation_id, name, channel, tone, subject, body, is_default)
  values (p_org, 'Final reminder', 'email', 'final',
    'Final reminder: invoice {{invoice_number}}',
    E'Hello {{customer_name}},\n\nThis is a final reminder that invoice {{invoice_number}} remains unpaid, {{days_overdue}} days after its due date. The outstanding balance is {{amount_outstanding}}.\n\nPlease make payment or contact us today so we can agree a way forward.\n\nRegards,\n{{organisation_name}}', true)
  returning id into t_final;

  insert into public.automation_rules (organisation_id, name, is_default)
  values (p_org, 'Standard recovery sequence', true) returning id into v_rule;

  insert into public.automation_rule_steps (organisation_id, rule_id, offset_days, stage, action, tone, template_id) values
    (p_org, v_rule, -5, 'Upcoming payment reminder', 'send', 'friendly', t_friendly),
    (p_org, v_rule, 0, 'Payment due today', 'send', 'professional', t_professional),
    (p_org, v_rule, 3, 'First overdue reminder', 'send', 'professional', t_professional),
    (p_org, v_rule, 7, 'Second overdue follow-up', 'send', 'firm', t_firm),
    (p_org, v_rule, 14, 'Escalate to finance manager', 'escalate', 'firm', null);
end $$;

create or replace function public.create_organisation(
  p_name text, p_currency text, p_timezone text, p_country text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_slug text;
begin
  if auth.uid() is null then perform app.fail('unauthenticated', 'Sign in to create an organisation.'); end if;
  if (select count(*) from public.organisations where created_by = auth.uid() and deleted_at is null) >= 10 then
    perform app.fail('limit', 'You have reached the maximum number of organisations for one account.');
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    perform app.fail('validation', 'Unknown time zone.');
  end if;
  v_slug := trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'));
  if v_slug = '' then v_slug := 'org'; end if;
  v_slug := left(v_slug, 40) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  insert into public.organisations (name, slug, base_currency, timezone, country, created_by)
  values (trim(p_name), v_slug, upper(p_currency), p_timezone, upper(p_country), auth.uid())
  returning id into v_org;

  insert into public.subscriptions (organisation_id, plan_id, status, trial_ends_at)
  values (v_org, 'growth', 'trialing', now() + interval '14 days');

  insert into public.organisation_members (organisation_id, user_id, role) values (v_org, auth.uid(), 'owner');
  perform app.seed_org_defaults(v_org);
  perform app.audit(v_org, 'organisation.created', 'organisation', v_org);
  return v_org;
end $$;

-- ---------------------------------------------------------------------------
-- Team management
-- ---------------------------------------------------------------------------
create or replace function app.check_member_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_under_limit(new.organisation_id, 'max_users',
    (select count(*) from public.organisation_members where organisation_id = new.organisation_id),
    'team members');
  return new;
end $$;
create trigger organisation_members_limit before insert on public.organisation_members
  for each row execute function app.check_member_limit();

create or replace function public.create_invitation(p_org uuid, p_email text, p_role public.org_role) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_email text := lower(trim(p_email));
  v_id uuid;
begin
  if not app.has_min_role(p_org, 'admin') then perform app.fail('forbidden', 'Only admins can invite team members.'); end if;
  if p_role = 'owner' then perform app.fail('validation', 'Ownership cannot be granted by invitation.'); end if;
  if exists (select 1 from public.organisation_members m join public.profiles p on p.id = m.user_id
             where m.organisation_id = p_org and lower(p.email) = v_email) then
    perform app.fail('validation', 'That person is already a member.');
  end if;
  perform app.require_under_limit(p_org, 'max_users',
    (select count(*) from public.organisation_members where organisation_id = p_org)
    + (select count(*) from public.organisation_invitations
       where organisation_id = p_org and accepted_at is null and revoked_at is null and expires_at > now()),
    'team members');
  update public.organisation_invitations set revoked_at = now()
    where organisation_id = p_org and lower(email) = v_email and accepted_at is null and revoked_at is null;
  insert into public.organisation_invitations (organisation_id, email, role, token_hash, invited_by)
  values (p_org, v_email, p_role, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), auth.uid())
  returning id into v_id;
  perform app.audit(p_org, 'member.invited', 'invitation', v_id, null, null, jsonb_build_object('email', v_email, 'role', p_role));
  return v_token;
end $$;

create or replace function public.revoke_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organisation_id into v_org from public.organisation_invitations where id = p_invitation;
  if v_org is null or not app.has_min_role(v_org, 'admin') then perform app.fail('forbidden', 'Not allowed.'); end if;
  update public.organisation_invitations set revoked_at = now() where id = p_invitation and accepted_at is null;
  perform app.audit(v_org, 'member.invitation_revoked', 'invitation', p_invitation);
end $$;

create or replace function public.invitation_preview(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('organisation', o.name, 'email', i.email, 'role', i.role,
    'valid', i.accepted_at is null and i.revoked_at is null and i.expires_at > now())
  from public.organisation_invitations i join public.organisations o on o.id = i.organisation_id
  where i.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
$$;

create or replace function public.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  i public.organisation_invitations;
  v_email text;
begin
  if auth.uid() is null then perform app.fail('unauthenticated', 'Sign in to accept the invitation.'); end if;
  select * into i from public.organisation_invitations
    where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') for update;
  if not found or i.accepted_at is not null or i.revoked_at is not null or i.expires_at <= now() then
    perform app.fail('invalid_invitation', 'This invitation is no longer valid.');
  end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is distinct from lower(i.email) then
    perform app.fail('invalid_invitation', 'This invitation was sent to a different email address.');
  end if;
  insert into public.organisation_members (organisation_id, user_id, role)
  values (i.organisation_id, auth.uid(), i.role)
  on conflict (organisation_id, user_id) do nothing;
  update public.organisation_invitations set accepted_at = now() where id = i.id;
  perform app.audit(i.organisation_id, 'member.joined', 'member', auth.uid(), null, null, jsonb_build_object('role', i.role));
  return i.organisation_id;
end $$;

create or replace function public.update_member_role(p_member uuid, p_role public.org_role) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.organisation_members;
begin
  select * into m from public.organisation_members where id = p_member for update;
  if not found or not app.has_min_role(m.organisation_id, 'admin') then perform app.fail('forbidden', 'Not allowed.'); end if;
  if (m.role = 'owner' or p_role = 'owner') and not app.has_min_role(m.organisation_id, 'owner') then
    perform app.fail('forbidden', 'Only an owner can change ownership.');
  end if;
  if m.role = 'owner' and p_role <> 'owner'
     and (select count(*) from public.organisation_members where organisation_id = m.organisation_id and role = 'owner') <= 1 then
    perform app.fail('validation', 'An organisation must keep at least one owner.');
  end if;
  update public.organisation_members set role = p_role where id = p_member;
  perform app.audit(m.organisation_id, 'member.role_changed', 'member', m.user_id, null, null,
    jsonb_build_object('from', m.role, 'to', p_role));
end $$;

create or replace function public.remove_member(p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.organisation_members;
begin
  select * into m from public.organisation_members where id = p_member for update;
  if not found then perform app.fail('forbidden', 'Not allowed.'); end if;
  if m.user_id <> auth.uid() and not app.has_min_role(m.organisation_id, 'admin') then
    perform app.fail('forbidden', 'Not allowed.');
  end if;
  if m.role = 'owner' then
    if m.user_id <> auth.uid() and not app.has_min_role(m.organisation_id, 'owner') then
      perform app.fail('forbidden', 'Only an owner can remove an owner.');
    end if;
    if (select count(*) from public.organisation_members where organisation_id = m.organisation_id and role = 'owner') <= 1 then
      perform app.fail('validation', 'An organisation must keep at least one owner.');
    end if;
  end if;
  delete from public.organisation_members where id = p_member;
  perform app.audit(m.organisation_id, 'member.removed', 'member', m.user_id);
end $$;

create or replace function public.delete_organisation(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.has_min_role(p_org, 'owner') then perform app.fail('forbidden', 'Only an owner can delete an organisation.'); end if;
  perform app.audit(p_org, 'organisation.deleted', 'organisation', p_org);
  -- Soft delete: members lose access immediately; data is retained for the legal retention period.
  update public.organisations set deleted_at = now() where id = p_org;
end $$;

create or replace function public.log_audit(p_org uuid, p_action text, p_entity_type text, p_entity_id uuid, p_metadata jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_org_member(p_org) then perform app.fail('forbidden', 'Not allowed.'); end if;
  perform app.audit(p_org, p_action, p_entity_type, p_entity_id, null, null, p_metadata);
end $$;

-- ---------------------------------------------------------------------------
-- Recovery helpers
-- ---------------------------------------------------------------------------
create or replace function app.cancel_pending_reminders(p_invoice uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.set_internal(true);
  update public.reminders set status = 'cancelled', last_error = p_reason
    where invoice_id = p_invoice and status in ('pending_approval', 'scheduled');
  perform app.set_internal(false);
end $$;

create or replace function app.set_workflow(p_invoice uuid, p_status public.workflow_status, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare inv public.invoices;
begin
  select * into inv from public.invoices where id = p_invoice;
  insert into public.recovery_workflows (organisation_id, invoice_id, rule_id, status, status_reason)
  values (inv.organisation_id, p_invoice,
          (select id from public.automation_rules where organisation_id = inv.organisation_id and is_default),
          p_status, p_reason)
  on conflict (invoice_id) do update
    set status = excluded.status, status_reason = excluded.status_reason,
        escalated_at = case when excluded.status = 'escalated' then now() else public.recovery_workflows.escalated_at end;
end $$;

-- Derives the workflow state from invoice + promise state. Single source of truth.
create or replace function app.sync_workflow(p_invoice uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  inv public.invoices;
  v_current public.workflow_status;
begin
  select * into inv from public.invoices where id = p_invoice;
  if inv.status = 'draft' then return; end if;
  select status into v_current from public.recovery_workflows where invoice_id = p_invoice;

  if inv.status = 'paid' then
    perform app.set_workflow(p_invoice, 'completed', 'Invoice paid in full');
    perform app.cancel_pending_reminders(p_invoice, 'Invoice paid');
  elsif inv.status = 'cancelled' or inv.archived_at is not null then
    perform app.set_workflow(p_invoice, 'stopped', case when inv.status = 'cancelled' then 'Invoice cancelled' else 'Invoice archived' end);
    perform app.cancel_pending_reminders(p_invoice, 'Invoice closed');
  elsif inv.status = 'disputed' then
    perform app.set_workflow(p_invoice, 'human_review', 'Invoice disputed: automation stopped until a person resolves it');
    perform app.cancel_pending_reminders(p_invoice, 'Invoice disputed');
  elsif inv.recovery_paused then
    perform app.set_workflow(p_invoice, 'paused', 'Paused by a team member');
    perform app.cancel_pending_reminders(p_invoice, 'Recovery paused');
  elsif exists (select 1 from public.payment_promises where invoice_id = p_invoice and status = 'pending') then
    perform app.set_workflow(p_invoice, 'awaiting_promise', 'Waiting for a promised payment');
    perform app.cancel_pending_reminders(p_invoice, 'Payment promise recorded');
  elsif v_current = 'escalated' then
    null; -- stays escalated until a person de-escalates
  else
    perform app.set_workflow(p_invoice, 'active', null);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Invoice items → invoice totals
-- ---------------------------------------------------------------------------
create or replace function app.invoice_items_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare inv public.invoices;
begin
  select * into inv from public.invoices where id = new.invoice_id for update;
  if not found then perform app.fail('validation', 'Invoice not found.'); end if;
  if inv.status in ('paid', 'cancelled') then
    perform app.fail('invoice_locked', 'Paid or cancelled invoices cannot be edited.');
  end if;
  new.organisation_id := inv.organisation_id;
  new.line_subtotal := round(new.quantity * new.unit_price, 2);
  if new.tax_rate is not null then
    new.tax_amount := round(new.line_subtotal * new.tax_rate / 100, 2);
  end if;
  new.line_total := new.line_subtotal + new.tax_amount;
  return new;
end $$;
create trigger invoice_items_before before insert or update on public.invoice_items
  for each row execute function app.invoice_items_before();

create or replace function app.invoice_items_before_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.invoices where id = old.invoice_id and status in ('paid', 'cancelled')) then
    perform app.fail('invoice_locked', 'Paid or cancelled invoices cannot be edited.');
  end if;
  return old;
end $$;
create trigger invoice_items_before_delete before delete on public.invoice_items
  for each row execute function app.invoice_items_before_delete();

create or replace function app.recalc_invoice_balance(p_invoice uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  inv public.invoices;
  v_paid numeric(14, 2);
  v_paid_on date;
  v_status public.invoice_status;
begin
  select * into inv from public.invoices where id = p_invoice for update;
  if not found then return; end if;
  select coalesce(sum(a.amount), 0), max(p.payment_date) into v_paid, v_paid_on
  from public.payment_allocations a join public.payments p on p.id = a.payment_id
  where a.invoice_id = p_invoice and p.voided_at is null;

  if v_paid > inv.total then
    perform app.fail('overpayment', 'Payments allocated to invoice ' || inv.invoice_number || ' would exceed its total.');
  end if;

  v_status := case
    when inv.status in ('draft', 'cancelled') then inv.status
    when inv.total > 0 and v_paid >= inv.total then 'paid'::public.invoice_status
    when inv.status = 'disputed' then 'disputed'::public.invoice_status
    when v_paid > 0 then 'partially_paid'::public.invoice_status
    else 'sent'::public.invoice_status end;

  perform app.set_internal(true);
  update public.invoices
    set amount_paid = v_paid, status = v_status,
        paid_on = case when v_status = 'paid' then v_paid_on else null end
    where id = p_invoice;

  -- A promise is fulfilled only by verified payments recorded after it was made.
  update public.payment_promises pp
    set status = 'fulfilled', resolved_at = now()
    where pp.invoice_id = p_invoice and pp.status = 'pending'
      and (v_status = 'paid' or v_paid - pp.baseline_amount_paid >= pp.promised_amount);
  perform app.set_internal(false);
end $$;

create or replace function app.recalc_invoice_totals(p_invoice uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.set_internal(true);
  update public.invoices i set
    subtotal = t.subtotal, tax_total = t.tax, total = t.subtotal + t.tax
  from (select coalesce(sum(line_subtotal), 0) as subtotal, coalesce(sum(tax_amount), 0) as tax
        from public.invoice_items where invoice_id = p_invoice) t
  where i.id = p_invoice;
  perform app.set_internal(false);
  perform app.recalc_invoice_balance(p_invoice);
end $$;

create or replace function app.invoice_items_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- skip when the parent invoice itself is being deleted (cascade)
  if tg_op = 'DELETE' then
    if exists (select 1 from public.invoices where id = old.invoice_id) then
      perform app.recalc_invoice_totals(old.invoice_id);
    end if;
    return old;
  end if;
  perform app.recalc_invoice_totals(new.invoice_id);
  return new;
end $$;
create trigger invoice_items_after after insert or update or delete on public.invoice_items
  for each row execute function app.invoice_items_after();

-- ---------------------------------------------------------------------------
-- Invoice guards and lifecycle
-- ---------------------------------------------------------------------------
create or replace function app.invoices_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_under_limit(new.organisation_id, 'max_invoices_per_month',
    (select count(*) from public.invoices
      where organisation_id = new.organisation_id and created_at >= date_trunc('month', now())),
    'invoices per month');
  if not exists (select 1 from public.customers where id = new.customer_id and organisation_id = new.organisation_id) then
    perform app.fail('validation', 'Customer does not belong to this organisation.');
  end if;
  -- New invoices always start as drafts with zero totals; items and status follow.
  new.status := 'draft';
  new.subtotal := 0; new.tax_total := 0; new.total := 0; new.amount_paid := 0;
  new.paid_on := null; new.sent_at := null; new.disputed_at := null;
  new.created_by := coalesce(auth.uid(), new.created_by);
  return new;
end $$;
create trigger invoices_before_insert before insert on public.invoices
  for each row execute function app.invoices_before_insert();

create or replace function app.invoices_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if new.organisation_id <> old.organisation_id then
    perform app.fail('validation', 'Invoices cannot move between organisations.');
  end if;
  if app.internal() then return new; end if;

  if new.subtotal <> old.subtotal or new.tax_total <> old.tax_total or new.total <> old.total
     or new.amount_paid <> old.amount_paid or new.paid_on is distinct from old.paid_on then
    perform app.fail('protected', 'Invoice totals and balances are calculated from line items and payments.');
  end if;

  if old.status in ('paid', 'cancelled') or old.amount_paid > 0 then
    if new.customer_id <> old.customer_id or new.currency <> old.currency then
      perform app.fail('invoice_locked', 'Customer and currency cannot change once payments exist or the invoice is closed.');
    end if;
  end if;
  if old.status in ('paid', 'cancelled') and
     (new.issue_date <> old.issue_date or new.due_date <> old.due_date or new.invoice_number <> old.invoice_number) then
    perform app.fail('invoice_locked', 'Paid or cancelled invoices cannot be edited.');
  end if;
  if new.customer_id <> old.customer_id and not exists
     (select 1 from public.customers where id = new.customer_id and organisation_id = new.organisation_id) then
    perform app.fail('validation', 'Customer does not belong to this organisation.');
  end if;

  if new.status <> old.status then
    if old.status = 'draft' and new.status = 'sent' then
      if new.total <= 0 then perform app.fail('validation', 'Add at least one line item before sending.'); end if;
      new.sent_at := now();
    elsif old.status = 'draft' and new.status = 'cancelled' then
      null;
    elsif old.status = 'sent' and new.status = 'cancelled' then
      null; -- amount_paid is 0 by definition of 'sent'
    elsif old.status in ('sent', 'partially_paid') and new.status = 'disputed' then
      new.status_before_dispute := old.status;
      new.disputed_at := now();
    elsif old.status = 'disputed' and new.status in ('sent', 'partially_paid') then
      new.status := case when old.amount_paid > 0 then 'partially_paid'::public.invoice_status else 'sent'::public.invoice_status end;
      new.disputed_at := null; new.dispute_reason := null; new.status_before_dispute := null;
    else
      perform app.fail('invalid_transition',
        'An invoice cannot go from ' || old.status || ' to ' || new.status
        || case when new.status in ('paid', 'partially_paid') then '. Record a payment instead.' else '.' end);
    end if;
  end if;
  return new;
end $$;
create trigger invoices_before_update before update on public.invoices
  for each row execute function app.invoices_before_update();

create or replace function app.invoices_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform app.audit(new.organisation_id, 'invoice.created', 'invoice', new.id, new.id, new.customer_id,
      jsonb_build_object('invoice_number', new.invoice_number));
    return new;
  end if;

  if new.status <> old.status then
    perform app.audit(new.organisation_id, 'invoice.' || new.status, 'invoice', new.id, new.id, new.customer_id,
      jsonb_build_object('from', old.status, 'to', new.status, 'reason', new.dispute_reason));
    if new.status = 'disputed' then
      perform app.notify_roles(new.organisation_id, 'finance_manager', 'dispute',
        'Invoice ' || new.invoice_number || ' was marked as disputed',
        'Automated reminders are stopped until someone reviews it.', '/invoices/' || new.id);
    end if;
    if new.status = 'cancelled' then
      perform app.set_internal(true);
      update public.payment_promises set status = 'cancelled', resolved_at = now()
        where invoice_id = new.id and status = 'pending';
      perform app.set_internal(false);
    end if;
  end if;
  if new.archived_at is distinct from old.archived_at then
    perform app.audit(new.organisation_id,
      case when new.archived_at is null then 'invoice.restored' else 'invoice.archived' end,
      'invoice', new.id, new.id, new.customer_id);
  end if;
  if new.recovery_paused <> old.recovery_paused then
    perform app.audit(new.organisation_id,
      case when new.recovery_paused then 'recovery.paused' else 'recovery.resumed' end,
      'invoice', new.id, new.id, new.customer_id);
  end if;
  if new.due_date <> old.due_date then
    perform app.audit(new.organisation_id, 'invoice.due_date_changed', 'invoice', new.id, new.id, new.customer_id,
      jsonb_build_object('from', old.due_date, 'to', new.due_date));
  end if;
  if new.status <> old.status or new.archived_at is distinct from old.archived_at
     or new.recovery_paused <> old.recovery_paused then
    perform app.sync_workflow(new.id);
  end if;
  return new;
end $$;
create trigger invoices_after after insert or update on public.invoices
  for each row execute function app.invoices_after();

-- Atomic create/update of an invoice with its line items.
create or replace function public.save_invoice(
  p_org uuid, p_invoice uuid, p_data jsonb, p_items jsonb, p_send boolean
) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_id uuid := p_invoice;
  v_item jsonb;
  v_pos integer := 0;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    perform app.fail('validation', 'An invoice needs at least one line item.');
  end if;
  if jsonb_array_length(p_items) > 200 then
    perform app.fail('validation', 'An invoice can have at most 200 line items.');
  end if;

  if v_id is null then
    insert into public.invoices (organisation_id, customer_id, invoice_number, issue_date, due_date, currency, notes, payment_reference)
    values (p_org, (p_data ->> 'customer_id')::uuid, trim(p_data ->> 'invoice_number'),
            (p_data ->> 'issue_date')::date, (p_data ->> 'due_date')::date, upper(p_data ->> 'currency'),
            nullif(p_data ->> 'notes', ''), nullif(p_data ->> 'payment_reference', ''))
    returning id into v_id;
  else
    update public.invoices set
      customer_id = (p_data ->> 'customer_id')::uuid,
      invoice_number = trim(p_data ->> 'invoice_number'),
      issue_date = (p_data ->> 'issue_date')::date,
      due_date = (p_data ->> 'due_date')::date,
      currency = upper(p_data ->> 'currency'),
      notes = nullif(p_data ->> 'notes', ''),
      payment_reference = nullif(p_data ->> 'payment_reference', '')
    where id = v_id and organisation_id = p_org;
    if not found then perform app.fail('not_found', 'Invoice not found.'); end if;
    delete from public.invoice_items where invoice_id = v_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.invoice_items (organisation_id, invoice_id, position, description, quantity, unit_price, tax_rate, tax_amount)
    values (p_org, v_id, v_pos, trim(v_item ->> 'description'),
            coalesce((v_item ->> 'quantity')::numeric, 1), (v_item ->> 'unit_price')::numeric,
            (v_item ->> 'tax_rate')::numeric, coalesce((v_item ->> 'tax_amount')::numeric, 0));
    v_pos := v_pos + 1;
  end loop;

  if p_send then
    update public.invoices set status = 'sent' where id = v_id and status = 'draft';
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Payments and allocations
-- ---------------------------------------------------------------------------
create or replace function app.payments_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_active(new.organisation_id);
  if not exists (select 1 from public.customers where id = new.customer_id and organisation_id = new.organisation_id) then
    perform app.fail('validation', 'Customer does not belong to this organisation.');
  end if;
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.voided_at := null; new.voided_by := null; new.void_reason := null;
  return new;
end $$;
create trigger payments_before_insert before insert on public.payments
  for each row execute function app.payments_before_insert();

create or replace function app.payments_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.voided_at is not null then
    perform app.fail('immutable', 'A voided payment cannot be changed.');
  end if;
  if new.voided_at is null or coalesce(trim(new.void_reason), '') = '' then
    perform app.fail('immutable', 'Payments are immutable. To correct one, void it with a reason and record a new payment.');
  end if;
  if (new.id, new.organisation_id, new.customer_id, new.amount, new.currency, new.payment_date, new.method,
      new.reference, new.notes, new.source, new.idempotency_key, new.created_by, new.created_at)
     is distinct from
     (old.id, old.organisation_id, old.customer_id, old.amount, old.currency, old.payment_date, old.method,
      old.reference, old.notes, old.source, old.idempotency_key, old.created_by, old.created_at) then
    perform app.fail('immutable', 'Only the void fields of a payment can change.');
  end if;
  new.voided_at := now();
  new.voided_by := auth.uid();
  return new;
end $$;
create trigger payments_before_update before update on public.payments
  for each row execute function app.payments_before_update();

create or replace function app.payments_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if tg_op = 'INSERT' then
    perform app.audit(new.organisation_id, 'payment.recorded', 'payment', new.id, null, new.customer_id,
      jsonb_build_object('amount', new.amount, 'currency', new.currency, 'reference', new.reference, 'source', new.source));
    return new;
  end if;
  perform app.audit(new.organisation_id, 'payment.voided', 'payment', new.id, null, new.customer_id,
    jsonb_build_object('amount', new.amount, 'currency', new.currency, 'reason', new.void_reason));
  for r in select invoice_id from public.payment_allocations where payment_id = new.id loop
    perform app.recalc_invoice_balance(r.invoice_id);
    perform app.audit(new.organisation_id, 'payment.voided', 'payment', new.id, r.invoice_id, new.customer_id,
      jsonb_build_object('reason', new.void_reason));
  end loop;
  return new;
end $$;
create trigger payments_after after insert or update on public.payments
  for each row execute function app.payments_after();

create or replace function app.block_mutation() returns trigger
language plpgsql as $$
begin
  perform app.fail('immutable', 'Rows in ' || tg_table_name || ' are part of the audit trail and cannot be changed or deleted.');
  return null;
end $$;
create trigger payments_no_delete before delete on public.payments
  for each row execute function app.block_mutation();
create trigger payment_allocations_immutable before update or delete on public.payment_allocations
  for each row execute function app.block_mutation();
create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function app.block_mutation();

create or replace function app.allocations_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p public.payments;
  inv public.invoices;
  v_allocated numeric(14, 2);
begin
  select * into p from public.payments where id = new.payment_id for update;
  select * into inv from public.invoices where id = new.invoice_id for update;
  if p.id is null or inv.id is null then perform app.fail('validation', 'Payment or invoice not found.'); end if;
  if p.organisation_id <> inv.organisation_id then perform app.fail('validation', 'Payment and invoice belong to different organisations.'); end if;
  if p.voided_at is not null then perform app.fail('validation', 'A voided payment cannot be allocated.'); end if;
  if p.customer_id <> inv.customer_id then perform app.fail('validation', 'Invoice ' || inv.invoice_number || ' belongs to a different customer.'); end if;
  if p.currency <> inv.currency then perform app.fail('validation', 'Invoice ' || inv.invoice_number || ' is in ' || inv.currency || ', not ' || p.currency || '.'); end if;
  if inv.status in ('draft', 'cancelled', 'paid') then
    perform app.fail('validation', 'Invoice ' || inv.invoice_number || ' is ' || inv.status || ' and cannot receive payments.');
  end if;
  if new.amount > inv.amount_outstanding then
    perform app.fail('overpayment', 'Allocation exceeds the outstanding balance of invoice ' || inv.invoice_number || '.');
  end if;
  select coalesce(sum(amount), 0) into v_allocated from public.payment_allocations where payment_id = p.id;
  if v_allocated + new.amount > p.amount then
    perform app.fail('overallocation', 'Allocations exceed the payment amount.');
  end if;
  new.organisation_id := p.organisation_id;
  return new;
end $$;
create trigger payment_allocations_before_insert before insert on public.payment_allocations
  for each row execute function app.allocations_before_insert();

create or replace function app.allocations_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_customer uuid;
begin
  perform app.recalc_invoice_balance(new.invoice_id);
  select customer_id into v_customer from public.invoices where id = new.invoice_id;
  perform app.audit(new.organisation_id, 'payment.allocated', 'payment', new.payment_id, new.invoice_id, v_customer,
    jsonb_build_object('amount', new.amount));
  return new;
end $$;
create trigger payment_allocations_after_insert after insert on public.payment_allocations
  for each row execute function app.allocations_after_insert();

-- Records a payment and its allocations in one transaction. Idempotent on (org, idempotency key).
create or replace function public.record_payment(
  p_org uuid, p_customer uuid, p_amount numeric, p_currency text, p_payment_date date,
  p_method text, p_reference text, p_notes text, p_allocations jsonb, p_idempotency_key text,
  p_source text default 'manual'
) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_id uuid;
  a jsonb;
begin
  if coalesce(trim(p_idempotency_key), '') = '' then perform app.fail('validation', 'Missing idempotency key.'); end if;
  select id into v_id from public.payments where organisation_id = p_org and idempotency_key = p_idempotency_key;
  if found then return v_id; end if;
  if p_payment_date > app.org_today(p_org) + 1 then
    perform app.fail('validation', 'Payment date cannot be in the future.');
  end if;

  insert into public.payments (organisation_id, customer_id, amount, currency, payment_date, method, reference, notes, source, idempotency_key)
  values (p_org, p_customer, p_amount, upper(p_currency), p_payment_date, coalesce(p_method, 'bank_transfer'),
          nullif(trim(p_reference), ''), nullif(trim(p_notes), ''), coalesce(p_source, 'manual'), p_idempotency_key)
  returning id into v_id;

  for a in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    insert into public.payment_allocations (organisation_id, payment_id, invoice_id, amount)
    values (p_org, v_id, (a ->> 'invoice_id')::uuid, (a ->> 'amount')::numeric);
  end loop;
  return v_id;
end $$;

create or replace function public.find_duplicate_payments(
  p_org uuid, p_customer uuid, p_amount numeric, p_payment_date date, p_reference text
) returns setof public.payments
language sql stable set search_path = '' as $$
  select p.* from public.payments p
  where p.organisation_id = p_org and p.voided_at is null
    and (
      (nullif(trim(p_reference), '') is not null and lower(p.reference) = lower(trim(p_reference)))
      or (p.customer_id = p_customer and p.amount = p_amount and abs(p.payment_date - p_payment_date) <= 3)
    )
  order by p.created_at desc limit 5
$$;

-- ---------------------------------------------------------------------------
-- Payment promises
-- ---------------------------------------------------------------------------
create or replace function app.promises_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare inv public.invoices;
begin
  select * into inv from public.invoices where id = new.invoice_id for update;
  if not found then perform app.fail('validation', 'Invoice not found.'); end if;
  perform app.require_feature(inv.organisation_id, 'promise_tracking', 'Payment promise tracking');
  if inv.status not in ('sent', 'partially_paid') or inv.archived_at is not null then
    perform app.fail('validation', 'Promises can only be recorded against open invoices.');
  end if;
  if new.promised_amount > inv.amount_outstanding then
    perform app.fail('validation', 'The promised amount is more than the outstanding balance.');
  end if;
  if new.promised_date < app.org_today(inv.organisation_id) then
    perform app.fail('validation', 'The promised date cannot be in the past.');
  end if;
  new.organisation_id := inv.organisation_id;
  new.customer_id := inv.customer_id;
  new.baseline_amount_paid := inv.amount_paid;
  new.status := 'pending';
  new.resolved_at := null;
  new.created_by := coalesce(auth.uid(), new.created_by);
  return new;
end $$;
create trigger payment_promises_before_insert before insert on public.payment_promises
  for each row execute function app.promises_before_insert();

create or replace function app.promises_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if app.internal() or auth.uid() is null then return new; end if;
  if (new.invoice_id, new.customer_id, new.organisation_id, new.promised_amount, new.promised_date, new.baseline_amount_paid)
     is distinct from
     (old.invoice_id, old.customer_id, old.organisation_id, old.promised_amount, old.promised_date, old.baseline_amount_paid) then
    perform app.fail('immutable', 'Record a new promise instead of changing an existing one.');
  end if;
  if new.status <> old.status then
    if old.status = 'pending' and new.status = 'cancelled' then
      new.resolved_at := now();
    else
      perform app.fail('invalid_transition',
        'Promises are marked fulfilled only by recorded payments, and broken only after the promised date passes.');
    end if;
  end if;
  return new;
end $$;
create trigger payment_promises_before_update before update on public.payment_promises
  for each row execute function app.promises_before_update();

create or replace function app.promises_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_number text;
begin
  if tg_op = 'INSERT' then
    perform app.audit(new.organisation_id, 'promise.created', 'promise', new.id, new.invoice_id, new.customer_id,
      jsonb_build_object('amount', new.promised_amount, 'date', new.promised_date));
    perform app.sync_workflow(new.invoice_id);
    return new;
  end if;
  if new.status <> old.status then
    perform app.audit(new.organisation_id, 'promise.' || new.status, 'promise', new.id, new.invoice_id, new.customer_id,
      jsonb_build_object('amount', new.promised_amount, 'date', new.promised_date));
    if new.status = 'broken' then
      select invoice_number into v_number from public.invoices where id = new.invoice_id;
      perform app.notify_roles(new.organisation_id, 'accountant', 'promise_broken',
        'Payment promise missed on invoice ' || v_number,
        'No verified payment was recorded by ' || to_char(new.promised_date, 'DD Mon YYYY') || '. Follow up with the customer.',
        '/invoices/' || new.invoice_id);
    end if;
    perform app.sync_workflow(new.invoice_id);
  end if;
  return new;
end $$;
create trigger payment_promises_after after insert or update on public.payment_promises
  for each row execute function app.promises_after();

-- Called by the worker. A promise is broken only when its date has passed in the
-- organisation's time zone without the promised amount being verified as paid.
create or replace function app.mark_broken_promises() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  with broken as (
    update public.payment_promises pp
      set status = 'broken', resolved_at = now(), follow_up_date = app.org_today(pp.organisation_id)
      where pp.status = 'pending' and pp.promised_date < app.org_today(pp.organisation_id)
      returning 1)
  select count(*) into v_count from broken;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Reminders
-- ---------------------------------------------------------------------------
create or replace function app.reminders_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  inv public.invoices;
  c public.customers;
begin
  if auth.uid() is null then return new; end if; -- worker inserts are validated by the planner
  select * into inv from public.invoices where id = new.invoice_id;
  if not found or inv.organisation_id <> new.organisation_id then perform app.fail('validation', 'Invoice not found.'); end if;
  if inv.status not in ('sent', 'partially_paid') or inv.archived_at is not null then
    perform app.fail('validation', 'Reminders can only be sent for open, undisputed invoices.');
  end if;
  select * into c from public.customers where id = inv.customer_id;
  if new.channel = 'email' and (c.email is null or c.email_opt_out) then
    perform app.fail('validation', 'This customer has no email address or has opted out of email.');
  end if;
  if new.channel = 'whatsapp' then
    perform app.require_feature(new.organisation_id, 'whatsapp', 'WhatsApp messaging');
    if c.phone is null or not c.whatsapp_opt_in then perform app.fail('validation', 'This customer has not opted in to WhatsApp messages.'); end if;
  end if;
  if new.channel = 'sms' then
    perform app.require_feature(new.organisation_id, 'sms', 'SMS messaging');
    if c.phone is null or not c.sms_opt_in then perform app.fail('validation', 'This customer has not opted in to SMS messages.'); end if;
  end if;
  perform app.require_under_limit(new.organisation_id, 'max_reminders_per_month',
    (app.usage(new.organisation_id) ->> 'reminders_this_month')::bigint, 'reminders per month');

  new.customer_id := inv.customer_id;
  new.created_by := auth.uid();
  new.generated_by := 'manual';
  new.step_id := null; new.sent_at := null; new.attempts := 0;
  if new.status = 'scheduled' and app.has_min_role(new.organisation_id, 'finance_manager') then
    new.approved_by := auth.uid(); new.approved_at := now();
  else
    new.status := 'pending_approval'; new.approved_by := null; new.approved_at := null;
  end if;
  return new;
end $$;
create trigger reminders_before_insert before insert on public.reminders
  for each row execute function app.reminders_before_insert();

create or replace function app.reminders_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if app.internal() or auth.uid() is null then return new; end if;
  if (new.organisation_id, new.invoice_id, new.customer_id, new.step_id, new.dedupe_key, new.sent_at, new.attempts)
     is distinct from
     (old.organisation_id, old.invoice_id, old.customer_id, old.step_id, old.dedupe_key, old.sent_at, old.attempts) then
    perform app.fail('protected', 'That reminder field cannot be changed.');
  end if;
  if old.status <> 'pending_approval' and (new.subject is distinct from old.subject or new.body <> old.body
      or new.channel <> old.channel) then
    perform app.fail('protected', 'Only reminders awaiting approval can be edited.');
  end if;
  if new.status <> old.status then
    if old.status = 'pending_approval' and new.status = 'scheduled' then
      new.approved_by := auth.uid(); new.approved_at := now();
      if new.scheduled_for < now() then new.scheduled_for := now(); end if;
    elsif old.status in ('pending_approval', 'scheduled') and new.status = 'cancelled' then
      null;
    elsif old.status = 'failed' and new.status = 'scheduled' then
      new.scheduled_for := now(); new.last_error := null; -- explicit human retry
    else
      perform app.fail('invalid_transition', 'A reminder cannot go from ' || old.status || ' to ' || new.status || '.');
    end if;
  end if;
  return new;
end $$;
create trigger reminders_before_update before update on public.reminders
  for each row execute function app.reminders_before_update();

create or replace function app.reminders_after_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> old.status and new.status in ('scheduled', 'sent', 'failed', 'cancelled') then
    perform app.audit(new.organisation_id,
      case new.status when 'scheduled' then 'reminder.approved' else 'reminder.' || new.status end,
      'reminder', new.id, new.invoice_id, new.customer_id,
      jsonb_build_object('stage', new.stage, 'channel', new.channel, 'tone', new.tone, 'error', new.last_error));
  end if;
  return new;
end $$;
create trigger reminders_after_update after update on public.reminders
  for each row execute function app.reminders_after_update();

-- ---------------------------------------------------------------------------
-- Misc guards
-- ---------------------------------------------------------------------------
create or replace function app.rules_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_under_limit(new.organisation_id, 'max_automation_rules',
    (select count(*) from public.automation_rules where organisation_id = new.organisation_id), 'automation sequences');
  return new;
end $$;
create trigger automation_rules_before_insert before insert on public.automation_rules
  for each row execute function app.rules_before_insert();

create or replace function app.rule_steps_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.automation_rules where id = new.rule_id and organisation_id = new.organisation_id) then
    perform app.fail('validation', 'Rule not found.');
  end if;
  if new.channel = 'whatsapp' then perform app.require_feature(new.organisation_id, 'whatsapp', 'WhatsApp messaging'); end if;
  if new.channel = 'sms' then perform app.require_feature(new.organisation_id, 'sms', 'SMS messaging'); end if;
  return new;
end $$;
create trigger automation_rule_steps_before before insert or update on public.automation_rule_steps
  for each row execute function app.rule_steps_before();

create or replace function app.rules_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if new.use_ai and not old.use_ai then
    perform app.require_feature(new.organisation_id, 'ai_reminders', 'AI-personalised reminders');
  end if;
  return new;
end $$;
create trigger automation_rules_before_update before update on public.automation_rules
  for each row execute function app.rules_before_update();

create or replace function app.jobs_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if new.job_type not in ('ai_draft_reminder', 'ai_extract_invoice') then
    perform app.fail('validation', 'Unknown job type.');
  end if;
  perform app.require_feature(new.organisation_id, 'ai_reminders', 'AI assistance');
  new.status := 'queued'; new.attempts := 0; new.result := null; new.last_error := null;
  new.created_by := auth.uid(); new.run_at := now();
  return new;
end $$;
create trigger background_jobs_before_insert before insert on public.background_jobs
  for each row execute function app.jobs_before_insert();

create or replace function app.customers_before_update() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if new.organisation_id <> old.organisation_id then
    perform app.fail('validation', 'Customers cannot move between organisations.');
  end if;
  if (new.email_opt_out, new.whatsapp_opt_in, new.sms_opt_in) is distinct from
     (old.email_opt_out, old.whatsapp_opt_in, old.sms_opt_in) then
    new.consent_updated_at := now();
  end if;
  return new;
end $$;
create trigger customers_before_update before update on public.customers
  for each row execute function app.customers_before_update();

create trigger profiles_touch before update on public.profiles for each row execute function app.touch_updated_at();
create trigger organisations_touch before update on public.organisations for each row execute function app.touch_updated_at();
create trigger templates_touch before update on public.communication_templates for each row execute function app.touch_updated_at();
create trigger workflows_touch before update on public.recovery_workflows for each row execute function app.touch_updated_at();
create trigger comm_logs_touch before update on public.communication_logs for each row execute function app.touch_updated_at();
create trigger integration_configs_touch before update on public.integration_configs for each row execute function app.touch_updated_at();
create trigger subscriptions_touch before update on public.subscriptions for each row execute function app.touch_updated_at();
create trigger jobs_touch before update on public.background_jobs for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Fixed-window rate limiter (service role only)
-- ---------------------------------------------------------------------------
create or replace function public.rate_limit_hit(p_bucket text, p_limit integer, p_window_seconds integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into public.rate_limits (bucket, window_start, hits) values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;
  delete from public.rate_limits where window_start < now() - interval '1 day';
  return v_hits <= p_limit;
end $$;
