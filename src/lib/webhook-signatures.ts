import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signature verification for inbound provider webhooks. Each function returns
 * true only when the signature matches the raw request body; callers must
 * reject the request otherwise. Pure functions so they can be unit tested.
 */

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const FIVE_MINUTES = 5 * 60;

/** Stripe: header "t=<unix>,v1=<hex hmac of `${t}.${body}`>". */
export function verifyStripeSignature(body: string, header: string | null, secret: string, nowSeconds = Date.now() / 1000): boolean {
  if (!header) return false;
  const parts = new Map<string, string[]>();
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2);
    if (k && v) parts.set(k.trim(), [...(parts.get(k.trim()) ?? []), v.trim()]);
  }
  const timestamp = Number(parts.get("t")?.[0]);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > FIVE_MINUTES) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return (parts.get("v1") ?? []).some((candidate) => equal(candidate, expected));
}

/** Razorpay: header X-Razorpay-Signature = hex hmac-sha256 of the raw body. */
export function verifyRazorpaySignature(body: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  return equal(header, createHmac("sha256", secret).update(body).digest("hex"));
}

/** Svix (used by Resend): base64 hmac of `${id}.${timestamp}.${body}`, secret "whsec_<base64>". */
export function verifySvixSignature(
  body: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
  nowSeconds = Date.now() / 1000,
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > FIVE_MINUTES) return false;
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", secretBytes).update(`${id}.${timestamp}.${body}`).digest("base64");
  return signature.split(" ").some((entry) => {
    const [version, value] = entry.split(",", 2);
    return version === "v1" && value !== undefined && equal(value, expected);
  });
}

/** Meta (WhatsApp Cloud API): header X-Hub-Signature-256 = "sha256=<hex hmac of body>". */
export function verifyMetaSignature(body: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  return equal(header.slice(7), createHmac("sha256", appSecret).update(body).digest("hex"));
}

/** Twilio: base64 hmac-sha1 of the full URL followed by each POST param (sorted by key) as key+value. */
export function verifyTwilioSignature(url: string, params: Record<string, string>, header: string | null, authToken: string): boolean {
  if (!header) return false;
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  return equal(header, createHmac("sha1", authToken).update(data).digest("base64"));
}
