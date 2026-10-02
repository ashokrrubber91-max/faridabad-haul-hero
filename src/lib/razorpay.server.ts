import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Server-only Razorpay helpers. Never import this from a component or from the
 * module scope of a *.functions.ts file.
 */

const RAZORPAY_API = "https://api.razorpay.com/v1";

export interface RazorpayCredentials {
  keyId: string;
  keySecret: string;
  checkoutConfigId?: string;
}

export function getRazorpayCredentials(): RazorpayCredentials | null {
  const keyId = process.env["RAZORPAY_KEY_ID"];
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keyId || !keySecret) return null;
  const checkoutConfigId =
    (keyId.startsWith("rzp_test_")
      ? process.env["RAZORPAY_TEST_CONFIG_ID"]
      : process.env["RAZORPAY_CHECKOUT_CONFIG_ID"]) || undefined;
  return { keyId, keySecret, checkoutConfigId };
}

function authHeader({ keyId, keySecret }: RazorpayCredentials): string {
  return `Basic ${btoa(`${keyId}:${keySecret}`)}`;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

/** Amount is in rupees; Razorpay works in paise. */
export async function createRazorpayOrder(
  creds: RazorpayCredentials,
  input: { amountRupees: number; receipt: string; notes?: Record<string, string>; configId?: string },
): Promise<RazorpayOrder> {
  const res = await fetch(`${RAZORPAY_API}/orders`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: authHeader(creds) },
    body: JSON.stringify({
      amount: Math.round(input.amountRupees * 100),
      currency: "INR",
      receipt: input.receipt,
      payment_capture: 1,
      ...(input.configId ? { config_id: input.configId } : {}),
      notes: input.notes ?? {},
    }),
  });
  const body = (await res.json()) as RazorpayOrder & { error?: { description?: string } };
  if (!res.ok) {
    throw new Error(body?.error?.description ?? "Could not start the payment. Please try again.");
  }
  return body;
}

export interface RazorpayPayment {
  id: string;
  order_id: string;
  status: string;
  amount: number;
  method?: string;
  error_description?: string;
}

export async function fetchRazorpayPayment(
  creds: RazorpayCredentials,
  paymentId: string,
): Promise<RazorpayPayment> {
  const res = await fetch(`${RAZORPAY_API}/payments/${paymentId}`, {
    headers: { Authorization: authHeader(creds) },
  });
  const body = (await res.json()) as RazorpayPayment & { error?: { description?: string } };
  if (!res.ok) throw new Error(body?.error?.description ?? "Payment lookup failed");
  return body;
}

function hmacSha256Hex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const left = Buffer.from(a, "hex");
    const right = Buffer.from(b, "hex");
    return left.length === right.length && timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

/** Checkout callback signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export async function verifyCheckoutSignature(
  keySecret: string,
  orderId: string,
  paymentId: string,
  signature: string,
): Promise<boolean> {
  const expected = await hmacSha256Hex(keySecret, `${orderId}|${paymentId}`);
  return timingSafeEqualHex(expected, signature.toLowerCase());
}

/** Webhook signature: HMAC_SHA256(raw_body, webhook_secret). */
export async function verifyWebhookSignature(
  webhookSecret: string,
  rawBody: string,
  signature: string,
): Promise<boolean> {
  const expected = await hmacSha256Hex(webhookSecret, rawBody);
  return timingSafeEqualHex(expected, signature.toLowerCase());
}
