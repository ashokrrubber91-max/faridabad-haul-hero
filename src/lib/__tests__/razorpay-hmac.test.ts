import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyCheckoutSignature, verifyWebhookSignature } from "../razorpay.server";

describe("Razorpay HMAC validation", () => {
  it("accepts a valid checkout callback signature and rejects tampering", async () => {
    const secret = "unit-test-secret";
    const orderId = "order_test_123";
    const paymentId = "pay_test_123";
    const signature = createHmac("sha256", secret)
      .update(`${orderId}|${paymentId}`, "utf8")
      .digest("hex");

    await expect(verifyCheckoutSignature(secret, orderId, paymentId, signature)).resolves.toBe(true);
    await expect(
      verifyCheckoutSignature(secret, orderId, paymentId, "00".repeat(32)),
    ).resolves.toBe(false);
  });

  it("accepts a valid webhook signature and rejects a changed body", async () => {
    const secret = "webhook-secret";
    const body = JSON.stringify({ event: "payment.captured", id: "evt_1" });
    const signature = createHmac("sha256", secret).update(body, "utf8").digest("hex");

    await expect(verifyWebhookSignature(secret, body, signature)).resolves.toBe(true);
    await expect(verifyWebhookSignature(secret, body + "tampered", signature)).resolves.toBe(false);
  });
});
