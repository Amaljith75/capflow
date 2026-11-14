import type { Role } from "@/lib/permissions";

export type InvoiceStatus = "draft" | "sent" | "partially_paid" | "paid" | "overdue" | "disputed" | "cancelled";
export type PromiseStatus = "pending" | "fulfilled" | "broken" | "cancelled";
export type ReminderStatus = "pending_approval" | "scheduled" | "sending" | "sent" | "failed" | "cancelled" | "skipped";
export type WorkflowStatus = "active" | "paused" | "awaiting_promise" | "escalated" | "human_review" | "completed" | "stopped";
export type Channel = "email" | "whatsapp" | "sms";
export type Tone = "friendly" | "professional" | "firm" | "final";

export interface Organisation {
  id: string;
  name: string;
  slug: string;
  legal_name: string | null;
  tax_id: string | null;
  billing_email: string | null;
  address: string | null;
  country: string;
  base_currency: string;
  timezone: string;
}

export interface Membership {
  id: string;
  organisation_id: string;
  role: Role;
  organisations: Organisation;
}

export interface Customer {
  id: string;
  organisation_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  billing_address: string | null;
  tax_id: string | null;
  currency: string;
  payment_terms_days: number;
  notes: string | null;
  email_opt_out: boolean;
  whatsapp_opt_in: boolean;
  sms_opt_in: boolean;
  consent_updated_at: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface CustomerStats {
  customer_id: string;
  customer_name: string;
  customer_email: string | null;
  currency: string;
  invoice_count: number;
  open_invoice_count: number;
  overdue_invoice_count: number;
  overdue_30_plus_count: number;
  total_invoiced: number;
  total_paid: number;
  outstanding: number;
  overdue: number;
  max_days_overdue: number;
  avg_days_late: number | null;
  recent_avg_days_late: number | null;
  recent_paid_count: number;
  prior_avg_days_late: number | null;
  prior_paid_count: number;
  last_paid_on: string | null;
  broken_promises: number;
  pending_promises: number;
  risk_score: number;
  risk_level: "low" | "medium" | "high";
}

export interface InvoiceRow {
  id: string;
  organisation_id: string;
  customer_id: string;
  customer_name: string;
  customer_email: string | null;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  currency: string;
  subtotal: number;
  tax_total: number;
  total: number;
  amount_paid: number;
  amount_outstanding: number;
  status: InvoiceStatus;
  effective_status: InvoiceStatus;
  is_open: boolean;
  days_overdue: number;
  ageing_bucket: string | null;
  notes: string | null;
  payment_reference: string | null;
  attachment_path: string | null;
  attachment_name: string | null;
  recovery_paused: boolean;
  dispute_reason: string | null;
  disputed_at: string | null;
  sent_at: string | null;
  paid_on: string | null;
  archived_at: string | null;
  created_at: string;
  today: string;
}

export interface InvoiceItem {
  id: string;
  position: number;
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number | null;
  tax_amount: number;
  line_subtotal: number;
  line_total: number;
}

export interface Payment {
  id: string;
  customer_id: string;
  amount: number;
  currency: string;
  payment_date: string;
  method: string;
  reference: string | null;
  notes: string | null;
  source: string;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
}

export interface PaymentPromise {
  id: string;
  invoice_id: string;
  customer_id: string;
  promised_amount: number;
  promised_date: string;
  status: PromiseStatus;
  notes: string | null;
  follow_up_date: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface Reminder {
  id: string;
  invoice_id: string;
  customer_id: string;
  stage: string;
  channel: Channel;
  tone: Tone;
  subject: string | null;
  body: string;
  generated_by: "template" | "ai" | "manual";
  ai_model: string | null;
  status: ReminderStatus;
  scheduled_for: string;
  sent_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface AutomationRule {
  id: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
  approval_mode: "manual" | "auto";
  use_ai: boolean;
  working_hours_start: string;
  working_hours_end: string;
  working_days: number[];
  max_attempts: number;
  min_hours_between: number;
}

export interface RuleStep {
  id: string;
  rule_id: string;
  offset_days: number;
  stage: string;
  action: "send" | "escalate";
  channel: Channel;
  tone: Tone;
  template_id: string | null;
}

export interface Template {
  id: string;
  name: string;
  channel: Channel;
  tone: Tone;
  subject: string | null;
  body: string;
  is_default: boolean;
}

export interface AuditLog {
  id: string;
  actor_id: string | null;
  actor_type: "user" | "system";
  action: string;
  entity_type: string;
  entity_id: string | null;
  invoice_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface PlanLimits {
  max_users: number | null;
  max_invoices_per_month: number | null;
  max_reminders_per_month: number | null;
  max_automation_rules: number | null;
  ai_reminders: boolean;
  whatsapp: boolean;
  sms: boolean;
  promise_tracking: boolean;
  advanced_analytics: boolean;
  bulk_operations: boolean;
}

export interface Entitlements {
  plan_id: string | null;
  status: "trialing" | "active" | "past_due" | "cancelled" | "expired" | "none";
  active: boolean;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  billing_interval: "monthly" | "annual" | null;
  provider: "stripe" | "razorpay" | null;
  limits: Partial<PlanLimits>;
  usage: { users: number; invoices_this_month: number; reminders_this_month: number; automation_rules: number };
}

export interface Plan {
  id: string;
  name: string;
  description: string;
  sort_order: number;
  prices: Record<string, { monthly: number; annual: number }> | null;
  entitlements: PlanLimits;
  provider_price_ids: Record<string, Record<string, string>>;
}

export interface DashboardSummary {
  currency: string;
  today: string;
  outstanding: number;
  outstanding_count: number;
  overdue: number;
  overdue_count: number;
  due_this_week: number;
  due_this_week_count: number;
  recovered_this_month: number;
  recovered_past_due_this_month: number;
  collection_rate_90d: number | null;
  avg_days_to_pay: number | null;
  disputed_count: number;
  ageing: Record<string, { amount: number; count: number }>;
}

export interface TrendPoint {
  month: string;
  invoiced: number;
  collected: number;
  outstanding_end: number;
}
