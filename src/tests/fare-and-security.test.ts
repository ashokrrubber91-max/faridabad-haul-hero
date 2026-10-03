import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { helperCharge, gstLineItems, requiresEwayBill } from "@/lib/booking-pricing";
import { verifyCheckoutSignature, verifyWebhookSignature } from "@/lib/razorpay.server";

describe("fare and security regression suite", () => {
  it("calculates helper add-ons", () => {
    expect(helperCharge(0)).toBe(0);
    expect(helperCharge(1)).toBe(250);
    expect(helperCharge(2)).toBe(500);
  });

  it("calculates GST totals", () => {
    expect(gstLineItems(1000, 0.18)).toEqual({ subtotal: 1000, tax: 180, total: 1180 });
  });

  it("requires E-Way Bill above ₹50,000 cargo value", () => {
    expect(requiresEwayBill(50000)).toBe(false);
    expect(requiresEwayBill(50000.01)).toBe(true);
  });

  it("accepts valid Indian mobile numbers only", () => {
    const indianMobile = /^[6-9]\d{9}$/;
    expect(indianMobile.test("9876543210")).toBe(true);
    expect(indianMobile.test("5876543210")).toBe(false);
    expect(indianMobile.test("987654321")).toBe(false);
  });

  it("uses HMAC verification for checkout callbacks", async () => {
    const secret = "test-secret";
    const orderId = "order_test_1";
    const paymentId = "pay_test_1";
    const signature = createHmac("sha256", secret)
      .update(orderId + "|" + paymentId, "utf8")
      .digest("hex");

    await expect(verifyCheckoutSignature(secret, orderId, paymentId, signature)).resolves.toBe(true);
    await expect(
      verifyCheckoutSignature(secret, orderId, paymentId, "00".repeat(32)),
    ).resolves.toBe(false);
  });

  it("uses HMAC verification for Razorpay webhooks", async () => {
    const secret = "webhook-secret";
    const body = '{"event":"payment.captured","id":"evt_1"}';
    const signature = createHmac("sha256", secret).update(body, "utf8").digest("hex");

    await expect(verifyWebhookSignature(secret, body, signature)).resolves.toBe(true);
    await expect(verifyWebhookSignature(secret, body + "x", signature)).resolves.toBe(false);
  });
});
