import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mapRazorpayStatus, mapStripeStatus, razorpayEventToUpdate, stripeEventToUpdate } from "@/lib/billing/events";
import { verifyMetaSignature, verifyRazorpaySignature, verifyStripeSignature, verifySvixSignature, verifyTwilioSignature } from "@/lib/webhook-signatures";

const body = JSON.stringify({ id: "evt_1", type: "test" });

describe("webhook signature verification", () => {
  it("stripe: accepts a valid signature and rejects tampering and replay", () => {
    const t = 1_800_000_000;
    const sig = createHmac("sha256", "whsec_x").update(`${t}.${body}`).digest("hex");
    expect(verifyStripeSignature(body, `t=${t},v1=${sig}`, "whsec_x", t + 10)).toBe(true);
    expect(verifyStripeSignature(body + " ", `t=${t},v1=${sig}`, "whsec_x", t + 10)).toBe(false);
    expect(verifyStripeSignature(body, `t=${t},v1=${sig}`, "other", t + 10)).toBe(false);
    expect(verifyStripeSignature(body, `t=${t},v1=${sig}`, "whsec_x", t + 3600)).toBe(false);
    expect(verifyStripeSignature(body, null, "whsec_x")).toBe(false);
  });

  it("razorpay", () => {
    const sig = createHmac("sha256", "rzp").update(body).digest("hex");
    expect(verifyRazorpaySignature(body, sig, "rzp")).toBe(true);
    expect(verifyRazorpaySignature(body, sig.replace(/.$/, "0"), "rzp")).toBe(sig.endsWith("0"));
    expect(verifyRazorpaySignature(body, null, "rzp")).toBe(false);
  });

  it("svix / resend", () => {
    const secret = `whsec_${Buffer.from("secret-bytes").toString("base64")}`;
    const ts = "1800000000";
    const sig = createHmac("sha256", Buffer.from("secret-bytes")).update(`msg_1.${ts}.${body}`).digest("base64");
    const headers = { id: "msg_1", timestamp: ts, signature: `v1,bad v1,${sig}` };
    expect(verifySvixSignature(body, headers, secret, 1_800_000_000)).toBe(true);
    expect(verifySvixSignature(body, { ...headers, id: "msg_2" }, secret, 1_800_000_000)).toBe(false);
  });

  it("meta / whatsapp", () => {
    const sig = createHmac("sha256", "app").update(body).digest("hex");
    expect(verifyMetaSignature(body, `sha256=${sig}`, "app")).toBe(true);
    expect(verifyMetaSignature(body, sig, "app")).toBe(false);
  });

  it("twilio", () => {
    const url = "https://app.test/api/webhooks/twilio";
    const params = { MessageSid: "SM1", MessageStatus: "delivered" };
    const sig = createHmac("sha1", "tok").update(`${url}MessageSidSM1MessageStatusdelivered`).digest("base64");
    expect(verifyTwilioSignature(url, params, sig, "tok")).toBe(true);
    expect(verifyTwilioSignature(url, { ...params, MessageStatus: "failed" }, sig, "tok")).toBe(false);
  });
});

describe("billing event mapping", () => {
  const org = "11111111-1111-4111-8111-111111111111";

  it("maps stripe checkout completion to an active subscription", () => {
    const update = stripeEventToUpdate({
      type: "checkout.session.completed",
      data: { object: { mode: "subscription", customer: "cus_1", subscription: "sub_1", metadata: { organisation_id: org, plan_id: "growth", interval: "monthly" } } },
    });
    expect(update).toMatchObject({ organisationId: org, planId: "growth", status: "active", interval: "monthly", provider: "stripe", subscriptionId: "sub_1" });
  });

  it("reads period end from the subscription item when the top-level field is absent", () => {
    const update = stripeEventToUpdate({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1", status: "past_due", cancel_at_period_end: true, metadata: { organisation_id: org }, items: { data: [{ current_period_end: 1_800_000_000 }] } } },
    });
    expect(update?.status).toBe("past_due");
    expect(update?.cancelAtPeriodEnd).toBe(true);
    expect(update?.periodEnd).toBe(new Date(1_800_000_000_000).toISOString());
  });

  it("ignores events without an organisation", () => {
    expect(stripeEventToUpdate({ type: "customer.subscription.updated", data: { object: { metadata: {} } } })).toBeNull();
    expect(stripeEventToUpdate({ type: "invoice.created", data: { object: {} } })).toBeNull();
  });

  it("maps stripe and razorpay statuses", () => {
    expect(mapStripeStatus("canceled")).toBe("cancelled");
    expect(mapStripeStatus("unpaid")).toBe("past_due");
    expect(mapRazorpayStatus("subscription.charged", "active")).toBe("active");
    expect(mapRazorpayStatus("subscription.halted", "halted")).toBe("past_due");
    expect(mapRazorpayStatus("subscription.authenticated", "authenticated")).toBeNull();
  });

  it("maps a razorpay cancellation", () => {
    const update = razorpayEventToUpdate({
      event: "subscription.cancelled",
      payload: { subscription: { entity: { id: "sub_r", status: "cancelled", current_end: 1_800_000_000, notes: { organisation_id: org, plan_id: "business" } } } },
    });
    expect(update).toMatchObject({ status: "cancelled", planId: "business", provider: "razorpay", subscriptionId: "sub_r" });
  });
});
