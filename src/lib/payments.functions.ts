import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Publishable Razorpay key id + whether payments are configured at all. */
export const getPaymentConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { getRazorpayCredentials } = await import("@/lib/razorpay.server");
  const creds = getRazorpayCredentials();
  return { configured: !!creds, keyId: creds?.keyId ?? null };
});

/** Creates a Razorpay order only from the authoritative booking fare. */
export const createTripOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ bookingId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { createRazorpayOrder, getRazorpayCredentials } = await import("@/lib/razorpay.server");
    const creds = getRazorpayCredentials();
    if (!creds) throw new Error("Online payments are not configured yet.");

    const { data: booking, error } = await context.supabase
      .from("bookings")
      .select("id, customer_id, fare, payment_status, payment_method")
      .eq("id", data.bookingId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!booking || booking.customer_id !== context.userId) throw new Error("Booking not found");
    if (booking.payment_status === "paid") throw new Error("This trip is already paid");

    const amount = Number(booking.fare);
    if (!(amount > 0)) throw new Error("Nothing to pay for this trip");

    const order = await createRazorpayOrder(creds, {
      amountRupees: amount,
      receipt: `mp_${booking.id.slice(0, 30)}`,
      notes: { booking_id: booking.id, customer_id: context.userId },
    });
    if (order.currency !== "INR") throw new Error("Razorpay returned an unsupported currency");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: insertError } = await supabaseAdmin.from("payments").insert({
      booking_id: booking.id,
      customer_id: context.userId,
      provider_order_id: order.id,
      amount,
      currency: "INR",
      state: "created",
      method: booking.payment_method,
    });
    if (insertError) throw new Error(insertError.message);

    return { orderId: order.id, amount, keyId: creds.keyId, currency: "INR" };
  });

/** Verifies checkout and settles payment exactly once against the stored booking amount. */
export const confirmTripPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      orderId: z.string().min(6).max(120),
      paymentId: z.string().min(6).max(120),
      signature: z.string().min(16).max(256),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { getRazorpayCredentials, verifyCheckoutSignature, fetchRazorpayPayment } = await import(
      "@/lib/razorpay.server"
    );
    const creds = getRazorpayCredentials();
    if (!creds) throw new Error("Online payments are not configured yet.");

    const valid = await verifyCheckoutSignature(creds.keySecret, data.orderId, data.paymentId, data.signature);
    if (!valid) throw new Error("Payment could not be verified");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: record } = await supabaseAdmin
      .from("payments")
      .select("id, booking_id, customer_id, amount, currency, state, provider_payment_id")
      .eq("provider_order_id", data.orderId)
      .maybeSingle();
    if (!record || record.customer_id !== context.userId) throw new Error("Payment record not found");

    if (record.state === "paid") {
      if (record.provider_payment_id === data.paymentId) return { ok: true, bookingId: record.booking_id, idempotent: true };
      throw new Error("This payment order is already settled");
    }

    const { data: booking } = await supabaseAdmin
      .from("bookings")
      .select("id, customer_id, fare, payment_status")
      .eq("id", record.booking_id)
      .maybeSingle();
    if (!booking || booking.customer_id !== context.userId) throw new Error("Booking/payment ownership mismatch");
    if (Number(booking.fare) !== Number(record.amount)) throw new Error("Payment amount does not match booking fare");
    if (record.currency !== "INR") throw new Error("Unsupported payment currency");

    const payment = await fetchRazorpayPayment(creds, data.paymentId);
    const paidRupees = payment.amount / 100;
    const captured = payment.status === "captured";
    const amountMatches = Math.abs(paidRupees - Number(record.amount)) < 0.01;
    if (!captured || payment.order_id !== data.orderId || !amountMatches) {
      await supabaseAdmin.from("payments").update({ state: "failed", provider_payment_id: data.paymentId, error: `Verification failed: ${payment.status}` }).eq("id", record.id).eq("state", "created");
      throw new Error("Payment was not completed or amount/order did not match");
    }

    const { data: settled, error: settleError } = await supabaseAdmin
      .from("payments")
      .update({ state: "paid", provider_payment_id: data.paymentId, provider_signature: data.signature, method: payment.method ?? null })
      .eq("id", record.id)
      .eq("state", "created")
      .select("id")
      .maybeSingle();
    if (settleError) throw new Error(settleError.message);
    if (!settled) {
      const { data: current } = await supabaseAdmin.from("payments").select("state, provider_payment_id").eq("id", record.id).maybeSingle();
      if (current?.state === "paid" && current.provider_payment_id === data.paymentId) return { ok: true, bookingId: record.booking_id, idempotent: true };
      throw new Error("Payment settlement conflict");
    }

    const { error: bookingError } = await supabaseAdmin
      .from("bookings")
      .update({ payment_status: "paid" })
      .eq("id", record.booking_id)
      .eq("customer_id", context.userId);
    if (bookingError) throw new Error(bookingError.message);

    return { ok: true, bookingId: record.booking_id, idempotent: false };
  });
