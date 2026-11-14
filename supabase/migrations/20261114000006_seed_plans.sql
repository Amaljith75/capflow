-- Capflow · 0006 · subscription plans
-- Prices are in minor units and are configuration, not code: edit this table
-- (prices, entitlements, provider_price_ids) to change the commercial offer.
-- A null limit means unlimited.

insert into public.subscription_plans (id, name, description, sort_order, prices, entitlements) values
('starter', 'Starter', 'Invoice and customer management with basic reminders.', 1,
  '{"INR": {"monthly": 49900, "annual": 499000}, "USD": {"monthly": 900, "annual": 9000}}',
  '{"max_users": 1, "max_invoices_per_month": 50, "max_reminders_per_month": 100, "max_automation_rules": 1,
    "ai_reminders": false, "whatsapp": false, "sms": false, "promise_tracking": false,
    "advanced_analytics": false, "bulk_operations": false}'),
('growth', 'Growth', 'AI-personalised recovery automation, promise tracking and advanced analytics.', 2,
  '{"INR": {"monthly": 149900, "annual": 1499000}, "USD": {"monthly": 2900, "annual": 29000}}',
  '{"max_users": 3, "max_invoices_per_month": 500, "max_reminders_per_month": 2000, "max_automation_rules": 3,
    "ai_reminders": true, "whatsapp": true, "sms": true, "promise_tracking": true,
    "advanced_analytics": true, "bulk_operations": false}'),
('business', 'Business', 'Multiple users, team permissions, bulk operations and advanced automation.', 3,
  '{"INR": {"monthly": 399900, "annual": 3999000}, "USD": {"monthly": 7900, "annual": 79000}}',
  '{"max_users": 15, "max_invoices_per_month": 5000, "max_reminders_per_month": 20000, "max_automation_rules": 20,
    "ai_reminders": true, "whatsapp": true, "sms": true, "promise_tracking": true,
    "advanced_analytics": true, "bulk_operations": true}'),
('enterprise', 'Enterprise', 'Custom limits, integrations and dedicated support.', 4,
  null,
  '{"max_users": null, "max_invoices_per_month": null, "max_reminders_per_month": null, "max_automation_rules": null,
    "ai_reminders": true, "whatsapp": true, "sms": true, "promise_tracking": true,
    "advanced_analytics": true, "bulk_operations": true}')
on conflict (id) do nothing;
