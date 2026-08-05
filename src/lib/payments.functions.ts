import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Publishable Razorpay key id + whether payments are configured at all. */
export const getPaymentConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { getRazorpayCredentials } = await import("@/lib/razorpay.server");
  const creds = getRazorpayCredentials();
  return { configured: !!creds, keyId: creds?.keyId ?? null };
});

/**
 * Creates a Razorpay order for a booking the caller owns. The amount always
 * comes from the server-computed fare on the booking row, never from the client.
 */
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

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: insertError } = await supabaseAdmin.from("payments").insert({
      booking_id: booking.id,
      customer_id: context.userId,
      provider_order_id: order.id,
      amount,
      state: "created",
      method: booking.payment_method,
    });
    if (insertError) throw new Error(insertError.message);

    return { orderId: order.id, amount, keyId: creds.keyId, currency: order.currency };
  });

/**
 * Verifies the checkout callback signature, re-checks the payment with Razorpay,
 * and only then marks the trip paid.
 */
export const confirmTripPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        orderId: z.string().min(6).max(120),
        paymentId: z.string().min(6).max(120),
        signature: z.string().min(16).max(256),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { getRazorpayCredentials, verifyCheckoutSignature, fetchRazorpayPayment } = await import(
      "@/lib/razorpay.server"
    );
    const creds = getRazorpayCredentials();
    if (!creds) throw new Error("Online payments are not configured yet.");

    const valid = await verifyCheckoutSignature(
      creds.keySecret,
      data.orderId,
      data.paymentId,
      data.signature,
    );
    if (!valid) throw new Error("Payment could not be verified");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: record } = await supabaseAdmin
      .from("payments")
      .select("id, booking_id, customer_id, amount, state")
      .eq("provider_order_id", data.orderId)
      .maybeSingle();
    if (!record || record.customer_id !== context.userId) throw new Error("Payment record not found");

    const payment = await fetchRazorpayPayment(creds, data.paymentId);
    const paidRupees = payment.amount / 100;
    const captured = payment.status === "captured" || payment.status === "authorized";
    if (!captured || payment.order_id !== data.orderId || paidRupees + 0.01 < Number(record.amount)) {
      await supabaseAdmin
        .from("payments")
        .update({ state: "failed", provider_payment_id: data.paymentId, error: payment.status })
        .eq("id", record.id);
      throw new Error("Payment was not completed");
    }

    await supabaseAdmin
      .from("payments")
      .update({
        state: "paid",
        provider_payment_id: data.paymentId,
        provider_signature: data.signature,
        method: payment.method ?? null,
      })
      .eq("id", record.id);

    if (record.booking_id) {
      await supabaseAdmin
        .from("bookings")
        .update({ payment_status: "paid" })
        .eq("id", record.booking_id);
    }

    return { ok: true, bookingId: record.booking_id };
  });
