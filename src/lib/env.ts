import "server-only";

/** Server-side environment access. Optional integrations return null when unset. */
function optional(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : null;
}

export const env = {
  supabaseUrl: () => optional("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => optional("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceKey: () => optional("SUPABASE_SERVICE_ROLE_KEY"),
  appUrl: () => (optional("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000").replace(/\/$/, ""),
  encryptionKey: () => optional("APP_ENCRYPTION_KEY"),
  resendKey: () => optional("RESEND_API_KEY"),
  emailFrom: () => optional("EMAIL_FROM"),
  resendWebhookSecret: () => optional("RESEND_WEBHOOK_SECRET"),
  stripeKey: () => optional("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: () => optional("STRIPE_WEBHOOK_SECRET"),
  razorpayKeyId: () => optional("RAZORPAY_KEY_ID"),
  razorpayKeySecret: () => optional("RAZORPAY_KEY_SECRET"),
  razorpayWebhookSecret: () => optional("RAZORPAY_WEBHOOK_SECRET"),
  whatsappAppSecret: () => optional("WHATSAPP_APP_SECRET"),
  whatsappVerifyToken: () => optional("WHATSAPP_VERIFY_TOKEN"),
  twilioAuthToken: () => optional("TWILIO_AUTH_TOKEN"),
};

export function isSupabaseConfigured(): boolean {
  return env.supabaseUrl() !== null && env.supabaseAnonKey() !== null;
}
