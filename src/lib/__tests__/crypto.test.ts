import { beforeAll, describe, expect, it } from "vitest";

const KEY = "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=";

beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY = KEY;
});

describe("crypto shared with the Python worker", () => {
  it("produces the same unsubscribe token as worker/tests/test_units.py", async () => {
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await import("@/lib/crypto");
    const token = signUnsubscribeToken("8d0f6c1e-0000-4000-8000-000000000001");
    expect(token).toBe("8d0f6c1e-0000-4000-8000-000000000001.kl1DyC0mqRhBD8pxvHaJz2OeO7EHInD45eu8KpbNUWY");
    expect(verifyUnsubscribeToken(token)).toBe("8d0f6c1e-0000-4000-8000-000000000001");
    expect(verifyUnsubscribeToken(token.slice(0, -2) + "xx")).toBeNull();
    expect(verifyUnsubscribeToken("not-a-token")).toBeNull();
  });

  it("round-trips secrets and rejects tampering", async () => {
    const { decryptSecret, encryptSecret } = await import("@/lib/crypto");
    const sealed = encryptSecret("sk-live-abc");
    expect(decryptSecret(sealed)).toBe("sk-live-abc");
    const bytes = Buffer.from(sealed, "base64");
    bytes[bytes.length - 1] ^= 1;
    expect(() => decryptSecret(bytes.toString("base64"))).toThrow();
  });
});
