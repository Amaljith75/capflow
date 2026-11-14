import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * AES-256-GCM envelope for tenant integration secrets. Format (base64):
 * 12-byte IV || 16-byte auth tag || ciphertext. The Python worker implements
 * the same format in capflow_worker/crypto.py.
 */
function key(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is not configured");
  const buffer = Buffer.from(raw, "base64");
  if (buffer.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return buffer;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

export function decryptSecret(envelope: string): string {
  const buffer = Buffer.from(envelope, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), buffer.subarray(0, 12));
  decipher.setAuthTag(buffer.subarray(12, 28));
  return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString("utf8");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Signed, non-guessable token for one-click unsubscribe links: "<customerId>.<hmac>". */
export function signUnsubscribeToken(customerId: string): string {
  const mac = createHmac("sha256", key()).update(`unsubscribe:${customerId}`).digest("base64url");
  return `${customerId}.${mac}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
  const [customerId, mac] = token.split(".");
  if (!customerId || !mac || !/^[0-9a-f-]{36}$/.test(customerId)) return null;
  try {
    return safeEqual(signUnsubscribeToken(customerId), token) ? customerId : null;
  } catch {
    return null;
  }
}
