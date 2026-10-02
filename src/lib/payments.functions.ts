import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withErrorLogging } from "@/lib/error-logger";

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
  .handler(({ data, context }) => withErrorLogging(async () => {
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

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Idempotency: a retried checkout for the same unpaid trip reuses the open order.
    const { data: existing } = await supabaseAdmin
      .from("payments")
      .select("provider_order_id, amount, state, currency")
      .eq("booking_id", booking.id)
      .eq("customer_id", context.userId)
      .eq("state", "created")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing && Math.abs(Number(existing.amount) - amount) < 0.01) {
      return {
        orderId: existing.provider_order_id,
        amount,
        keyId: creds.keyId,
        currency: existing.currency ?? "INR",
      };
    }

    const order = await createRazorpayOrder(creds, {
      amountRupees: amount,
      receipt: `mp_${booking.id.slice(0, 30)}`,
      notes: { booking_id: booking.id, customer_id: context.userId },
      configId: creds.checkoutConfigId,
    });
    if (order.currency !== "INR") throw new Error("Unsupported payment currency");

    const { error: insertError } = await supabaseAdmin.from("payments").insert({
      booking_id: booking.id,
      customer_id: context.userId,
      provider_order_id: order.id,
      amount,
      currency: order.currency,
      state: "created",
      method: booking.payment_method,
    });
    if (insertError) throw new Error(insertError.message);

    return { orderId: order.id, amount, keyId: creds.keyId, currency: order.currency };
  }, { source: "razorpay", action: "createTripOrder" });

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
  .handler(({ data, context }) => withErrorLogging(async () => {
    const { getRazorpayCredentials, verifyCheckoutSignature, fetchRazorpayPayment } =
      await import("@/lib/razorpay.server");
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
      .select("id, booking_id, customer_id, amount, state, currency")
      .eq("provider_order_id", data.orderId)
      .maybeSingle();
    if (!record || record.customer_id !== context.userId)
      throw new Error("Payment record not found");
    if (record.currency && record.currency !== "INR")
      throw new Error("Unsupported payment currency");
    // Duplicate confirmation (double-click, webhook race) is a no-op.
    if (record.state === "paid") return { ok: true, bookingId: record.booking_id };

    // The trip must exist, belong to this customer, and its stored fare must
    // equal the amount stored on the payment record.
    if (!record.booking_id) throw new Error("Payment record is not linked to a trip");
    const { data: booking } = await supabaseAdmin
      .from("bookings")
      .select("id, customer_id, fare, payment_status")
      .eq("id", record.booking_id)
      .maybeSingle();
    if (!booking || booking.customer_id !== context.userId) throw new Error("Trip not found");
    if (Math.abs(Number(booking.fare) - Number(record.amount)) > 0.01) {
      throw new Error("Payment amount does not match the trip fare");
    }

    const payment = await fetchRazorpayPayment(creds, data.paymentId);
    const paidRupees = payment.amount / 100;
    const amountMatches = Math.abs(paidRupees - Number(record.amount)) < 0.01;
    if (payment.status !== "captured" || payment.order_id !== data.orderId || !amountMatches) {
      await supabaseAdmin
        .from("payments")
        .update({ state: "failed", provider_payment_id: data.paymentId, error: payment.status })
        .eq("id", record.id)
        .eq("state", "created");
      throw new Error("Payment was not completed");
    }

    // Settle once: the guard on `state` makes a webhook/click race a no-op.
    await supabaseAdmin
      .from("payments")
      .update({
        state: "paid",
        provider_payment_id: data.paymentId,
        provider_signature: data.signature,
        method: payment.method ?? null,
      })
      .eq("id", record.id)
      .eq("state", "created");

    if (booking.payment_status !== "paid") {
      await supabaseAdmin
        .from("bookings")
        .update({ payment_status: "paid" })
        .eq("id", booking.id)
        .neq("payment_status", "paid");
    }

    return { ok: true, bookingId: record.booking_id };
  }, { source: "razorpay", action: "confirmTripPayment" });

export const createWalletTopupOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ amount: z.number().finite().min(100).max(100000) }).parse(input),
  )
  .handler(({ data, context }) => withErrorLogging(async () => {
    const { data: roleOk } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "driver",
    });
    if (!roleOk) throw new Error("Driver access required");
    const { createRazorpayOrder, getRazorpayCredentials } = await import("@/lib/razorpay.server");
    const creds = getRazorpayCredentials();
    if (!creds) throw new Error("Online payments are not configured yet.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin
      .from("payments")
      .select("provider_order_id, amount, currency, state")
      .eq("customer_id", context.userId)
      .eq("method", "wallet_topup")
      .eq("state", "created")
      .is("booking_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing && Math.abs(Number(existing.amount) - data.amount) < 0.01) {
      return {
        orderId: existing.provider_order_id,
        amount: data.amount,
        keyId: creds.keyId,
        currency: existing.currency ?? "INR",
      };
    }
    const order = await createRazorpayOrder(creds, {
      amountRupees: data.amount,
      receipt: "mp_topup_" + context.userId.slice(0, 18) + "_" + Date.now().toString(36),
      notes: { type: "wallet_topup", driver_id: context.userId },
      configId: creds.checkoutConfigId,
    });
    const { error } = await supabaseAdmin.from("payments").insert({
      booking_id: null,
      customer_id: context.userId,
      provider_order_id: order.id,
      amount: data.amount,
      currency: order.currency,
      state: "created",
      method: "wallet_topup",
    });
    if (error) throw new Error(error.message);
    return { orderId: order.id, amount: data.amount, keyId: creds.keyId, currency: order.currency };
  }, { source: "wallet", action: "createWalletTopupOrder" });

export const confirmWalletTopupPayment = createServerFn({ method: "POST" })
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
  .handler(({ data, context }) => withErrorLogging(async () => {
    const { getRazorpayCredentials, verifyCheckoutSignature, fetchRazorpayPayment } =
      await import("@/lib/razorpay.server");
    const creds = getRazorpayCredentials();
    if (!creds) throw new Error("Online payments are not configured yet.");
    if (
      !(await verifyCheckoutSignature(
        creds.keySecret,
        data.orderId,
        data.paymentId,
        data.signature,
      ))
    ) {
      throw new Error("Payment could not be verified");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: record } = await supabaseAdmin
      .from("payments")
      .select("id, customer_id, amount, state, currency, method")
      .eq("provider_order_id", data.orderId)
      .eq("method", "wallet_topup")
      .is("booking_id", null)
      .maybeSingle();

    if (!record || record.customer_id !== context.userId)
      throw new Error("Top-up payment not found");
    if (record.currency && record.currency !== "INR")
      throw new Error("Unsupported payment currency");

    if (record.state === "paid") {
      const { data: wallet } = await supabaseAdmin
        .from("wallet_accounts")
        .select("cash_balance")
        .eq("user_id", context.userId)
        .maybeSingle();
      return { ok: true, credited: true, balance: Number(wallet?.cash_balance ?? 0) };
    }

    const payment = await fetchRazorpayPayment(creds, data.paymentId);
    const amountMatches = Math.abs(payment.amount / 100 - Number(record.amount)) < 0.01;
    if (payment.status !== "captured" || payment.order_id !== data.orderId || !amountMatches) {
      await supabaseAdmin
        .from("payments")
        .update({
          state: "failed",
          provider_payment_id: data.paymentId,
          error: payment.status,
        })
        .eq("id", record.id)
        .eq("state", "created");
      throw new Error("Payment was not completed");
    }

    const { data: credit, error: creditError } = await supabaseAdmin.rpc(
      "credit_driver_wallet_topup",
      {
        _payment_id: record.id,
        _driver_id: context.userId,
        _amount: Number(record.amount),
        _provider_payment_id: data.paymentId,
      },
    );
    if (creditError) throw new Error(creditError.message);
    const result = credit as { ok?: boolean; balance?: number } | null;
    if (!result?.ok) throw new Error("Wallet top-up could not be completed");

    return { ok: true, credited: true, balance: Number(result.balance ?? 0) };
  }, { source: "wallet", action: "confirmWalletTopupPayment" });
