-- Capflow · 0004 · row level security and privileges
-- Role ladder: viewer < accountant < finance_manager < admin < owner.
-- Anything not granted here is denied. The service role bypasses RLS and is
-- used only by webhooks and the background worker, never by browser code.

alter table public.profiles enable row level security;
alter table public.organisations enable row level security;
alter table public.organisation_members enable row level security;
alter table public.organisation_invitations enable row level security;
alter table public.customers enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.payment_promises enable row level security;
alter table public.communication_templates enable row level security;
alter table public.automation_rules enable row level security;
alter table public.automation_rule_steps enable row level security;
alter table public.recovery_workflows enable row level security;
alter table public.reminders enable row level security;
alter table public.communication_logs enable row level security;
alter table public.integration_configs enable row level security;
alter table public.integration_secrets enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.billing_events enable row level security;
alter table public.audit_logs enable row level security;
alter table public.background_jobs enable row level security;
alter table public.notifications enable row level security;
alter table public.rate_limits enable row level security;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;

grant usage on schema app to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

grant select on public.subscription_plans to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, update on public.organisations to authenticated;
grant select on public.organisation_members, public.organisation_invitations to authenticated;
grant select, insert, update on public.customers to authenticated;
grant select, insert, update, delete on public.invoices, public.invoice_items to authenticated;
grant select, insert, update on public.payments to authenticated;
grant select, insert on public.payment_allocations to authenticated;
grant select, insert, update on public.payment_promises to authenticated;
grant select, insert, update, delete on public.communication_templates, public.automation_rules, public.automation_rule_steps to authenticated;
grant select, update on public.recovery_workflows to authenticated;
grant select, insert, update on public.reminders to authenticated;
grant select on public.communication_logs, public.subscriptions, public.audit_logs to authenticated;
grant select, insert, update on public.integration_configs to authenticated;
grant select, insert on public.background_jobs to authenticated;
grant select, update on public.notifications to authenticated;
grant select on public.invoice_ledger, public.customer_stats to authenticated;

grant execute on function
  public.create_organisation(text, text, text, text),
  public.org_entitlements(uuid),
  public.create_invitation(uuid, text, public.org_role),
  public.revoke_invitation(uuid),
  public.accept_invitation(text),
  public.update_member_role(uuid, public.org_role),
  public.remove_member(uuid),
  public.delete_organisation(uuid),
  public.log_audit(uuid, text, text, uuid, jsonb),
  public.save_invoice(uuid, uuid, jsonb, jsonb, boolean),
  public.save_rule_steps(uuid, jsonb),
  public.record_payment(uuid, uuid, numeric, text, date, text, text, text, jsonb, text, text),
  public.find_duplicate_payments(uuid, uuid, numeric, date, text),
  public.dashboard_summary(uuid, text),
  public.cashflow_trend(uuid, text, integer),
  public.collection_metrics(uuid, text, date, date),
  public.reminder_performance(uuid, date, date),
  public.currencies_in_use(uuid)
to authenticated;
grant execute on function public.invitation_preview(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
create or replace function app.shares_org_with(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organisation_members mine
    join public.organisation_members theirs on theirs.organisation_id = mine.organisation_id
    where mine.user_id = auth.uid() and theirs.user_id = p_user)
$$;
grant execute on function app.shares_org_with(uuid) to authenticated, service_role;

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or app.shares_org_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy organisations_select on public.organisations for select to authenticated
  using (app.is_org_member(id));
create policy organisations_update on public.organisations for update to authenticated
  using (app.has_min_role(id, 'admin')) with check (app.has_min_role(id, 'admin'));

create policy members_select on public.organisation_members for select to authenticated
  using (app.is_org_member(organisation_id));
create policy invitations_select on public.organisation_invitations for select to authenticated
  using (app.has_min_role(organisation_id, 'admin'));

create policy customers_select on public.customers for select to authenticated
  using (app.is_org_member(organisation_id));
create policy customers_insert on public.customers for insert to authenticated
  with check (app.has_min_role(organisation_id, 'accountant'));
create policy customers_update on public.customers for update to authenticated
  using (app.has_min_role(organisation_id, 'accountant')) with check (app.has_min_role(organisation_id, 'accountant'));

create policy invoices_select on public.invoices for select to authenticated
  using (app.is_org_member(organisation_id));
create policy invoices_insert on public.invoices for insert to authenticated
  with check (app.has_min_role(organisation_id, 'accountant'));
create policy invoices_update on public.invoices for update to authenticated
  using (app.has_min_role(organisation_id, 'accountant')) with check (app.has_min_role(organisation_id, 'accountant'));
-- Only never-sent drafts can be hard-deleted; everything else is archived.
create policy invoices_delete on public.invoices for delete to authenticated
  using (status = 'draft' and sent_at is null and app.has_min_role(organisation_id, 'accountant'));

create policy invoice_items_select on public.invoice_items for select to authenticated
  using (app.is_org_member(organisation_id));
create policy invoice_items_insert on public.invoice_items for insert to authenticated
  with check (app.has_min_role(organisation_id, 'accountant'));
create policy invoice_items_update on public.invoice_items for update to authenticated
  using (app.has_min_role(organisation_id, 'accountant')) with check (app.has_min_role(organisation_id, 'accountant'));
create policy invoice_items_delete on public.invoice_items for delete to authenticated
  using (app.has_min_role(organisation_id, 'accountant'));

create policy payments_select on public.payments for select to authenticated
  using (app.is_org_member(organisation_id));
create policy payments_insert on public.payments for insert to authenticated
  with check (app.has_min_role(organisation_id, 'accountant'));
-- update = void only (enforced by trigger); restricted to finance managers and above
create policy payments_void on public.payments for update to authenticated
  using (app.has_min_role(organisation_id, 'finance_manager')) with check (app.has_min_role(organisation_id, 'finance_manager'));

create policy allocations_select on public.payment_allocations for select to authenticated
  using (app.is_org_member(organisation_id));
create policy allocations_insert on public.payment_allocations for insert to authenticated
  with check (app.has_min_role(organisation_id, 'accountant'));

create policy promises_select on public.payment_promises for select to authenticated
  using (app.is_org_member(organisation_id));
create policy promises_insert on public.payment_promises for insert to authenticated
  with check (app.has_min_role(organisation_id, 'accountant'));
create policy promises_update on public.payment_promises for update to authenticated
  using (app.has_min_role(organisation_id, 'accountant')) with check (app.has_min_role(organisation_id, 'accountant'));

create policy templates_select on public.communication_templates for select to authenticated
  using (app.is_org_member(organisation_id));
create policy templates_write on public.communication_templates for all to authenticated
  using (app.has_min_role(organisation_id, 'finance_manager')) with check (app.has_min_role(organisation_id, 'finance_manager'));

create policy rules_select on public.automation_rules for select to authenticated
  using (app.is_org_member(organisation_id));
create policy rules_write on public.automation_rules for all to authenticated
  using (app.has_min_role(organisation_id, 'finance_manager')) with check (app.has_min_role(organisation_id, 'finance_manager'));

create policy rule_steps_select on public.automation_rule_steps for select to authenticated
  using (app.is_org_member(organisation_id));
create policy rule_steps_write on public.automation_rule_steps for all to authenticated
  using (app.has_min_role(organisation_id, 'finance_manager')) with check (app.has_min_role(organisation_id, 'finance_manager'));

create policy workflows_select on public.recovery_workflows for select to authenticated
  using (app.is_org_member(organisation_id));
-- de-escalation by a finance manager; all other transitions are system-driven
create policy workflows_update on public.recovery_workflows for update to authenticated
  using (status = 'escalated' and app.has_min_role(organisation_id, 'finance_manager'))
  with check (status = 'active' and app.has_min_role(organisation_id, 'finance_manager'));

create policy reminders_select on public.reminders for select to authenticated
  using (app.is_org_member(organisation_id));
create policy reminders_insert on public.reminders for insert to authenticated
  with check (app.has_min_role(organisation_id, 'accountant'));
create policy reminders_update on public.reminders for update to authenticated
  using (app.has_min_role(organisation_id, 'finance_manager')) with check (app.has_min_role(organisation_id, 'finance_manager'));

create policy comm_logs_select on public.communication_logs for select to authenticated
  using (app.is_org_member(organisation_id));

create policy integrations_select on public.integration_configs for select to authenticated
  using (app.is_org_member(organisation_id));
create policy integrations_insert on public.integration_configs for insert to authenticated
  with check (app.has_min_role(organisation_id, 'admin'));
create policy integrations_update on public.integration_configs for update to authenticated
  using (app.has_min_role(organisation_id, 'admin')) with check (app.has_min_role(organisation_id, 'admin'));
-- integration_secrets: no policies → service role only.

create policy plans_select on public.subscription_plans for select to anon, authenticated using (is_public);
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (app.is_org_member(organisation_id));
-- billing_events, rate_limits: no policies → service role only.

create policy audit_select on public.audit_logs for select to authenticated
  using (app.is_org_member(organisation_id));

create policy jobs_select on public.background_jobs for select to authenticated
  using (organisation_id is not null and app.is_org_member(organisation_id));
create policy jobs_insert on public.background_jobs for insert to authenticated
  with check (organisation_id is not null and app.has_min_role(organisation_id, 'accountant'));

create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid() and app.is_org_member(organisation_id));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
