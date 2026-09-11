import { createFileRoute } from "@tanstack/react-router";

/**
 * Razorpay webhook — the authoritative source of payment truth.
 * Subscribe to `payment.captured`, `payment.failed` and `refund.processed`
 * in the Razorpay dashboard and set the same signing secret as
 * RAZORPAY_WEBHOOK_SECRET.
 */
export const Route = createFileRoute("/api/public/razorpay-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["RAZORPAY_WEBHOOK_SECRET"];
        if (!secret) return new Response("Webhook not configured", { status: 503 });

        const signature = request.headers.get("x-razorpay-signature");
        const rawBody = await request.text();
        if (!signature) return new Response("Missing signature", { status: 401 });

        const { verifyWebhookSignature } = await import("@/lib/razorpay.server");
        if (!(await verifyWebhookSignature(secret, rawBody, signature))) {
          return new Response("Invalid signature", { status: 401 });
        }

        type Entity = {
          id?: string;
          order_id?: string;
          payment_id?: string;
          method?: string;
          currency?: string;
          error_description?: string;
          amount?: number;
        };
        let event: {
          event?: string;
          payload?: { payment?: { entity?: Entity }; refund?: { entity?: Entity } };
        };
        try {
          event = JSON.parse(rawBody);
        } catch {
          return new Response("Bad payload", { status: 400 });
        }

        const kind = event.event ?? "";
        const payment = event.payload?.payment?.entity;
        const refund = event.payload?.refund?.entity;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Razorpay retries deliveries; process each event exactly once.
        // Without the provider event id we derive a fingerprint from the exact
        // payload so two *different* events can never collapse into one key.
        const bodyDigest = [
          ...new Uint8Array(
            await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawBody)),
          ),
        ]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        const eventId =
          request.headers.get("x-razorpay-event-id") ??
          `${kind}:${payment?.id ?? refund?.id ?? "na"}:${bodyDigest}`;
        const { error: dedupeError } = await supabaseAdmin
          .from("webhook_events")
          .insert({ provider: "razorpay", event_id: eventId, event_type: kind });
        if (dedupeError) {
          // Unique violation => already handled. Anything else is a real failure:
          // return 500 so Razorpay retries later.
          if (dedupeError.code === "23505") return new Response("duplicate");
          return new Response("Could not record event", { status: 500 });
        }

        // ---------- Refunds ----------
        if (kind.startsWith("refund.") && refund?.payment_id) {
          const { data: record } = await supabaseAdmin
            .from("payments")
            .select("id, booking_id, state")
            .eq("provider_payment_id", refund.payment_id)
            .maybeSingle();
          if (!record) return new Response("ok");
          if (kind === "refund.processed" && record.state !== "refunded") {
            await supabaseAdmin.from("payments").update({ state: "refunded" }).eq("id", record.id);
            if (record.booking_id) {
              await supabaseAdmin
                .from("bookings")
                .update({ payment_status: "refunded" })
                .eq("id", record.booking_id);
            }
          }
          return new Response("ok");
        }

        if (!payment?.order_id) return new Response("ok");

        const { data: record } = await supabaseAdmin
          .from("payments")
          .select("id, booking_id, customer_id, amount, currency, state")
          .eq("provider_order_id", payment.order_id)
          .maybeSingle();
        if (!record) return new Response("ok");

        if (kind === "payment.captured") {
          // The captured amount and currency must match what we stored for this order.
          const paidRupees = typeof payment.amount === "number" ? payment.amount / 100 : NaN;
          const amountMatches = Math.abs(paidRupees - Number(record.amount)) < 0.01;
          const currencyOk =
            (payment.currency ?? "INR") === "INR" && (record.currency ?? "INR") === "INR";
          if (!amountMatches || !currencyOk) {
            await supabaseAdmin
              .from("payments")
              .update({
                state: "failed",
                provider_payment_id: payment.id ?? null,
                error: `Amount/currency mismatch (received ${String(payment.amount)} ${String(payment.currency)})`,
              })
              .eq("id", record.id)
              .eq("state", "created");
            return new Response("ok");
          }

          if (record.state !== "paid") {
            await supabaseAdmin
              .from("payments")
              .update({
                state: "paid",
                provider_payment_id: payment.id ?? null,
                method: payment.method ?? null,
              })
              .eq("id", record.id)
              .neq("state", "paid");
            if (record.booking_id) {
              await supabaseAdmin
                .from("bookings")
                .update({ payment_status: "paid" })
                .eq("id", record.booking_id)
                .neq("payment_status", "paid");
            }
          }
        } else if (kind === "payment.failed") {
          if (record.state === "created") {
            await supabaseAdmin
              .from("payments")
              .update({
                state: "failed",
                provider_payment_id: payment.id ?? null,
                error: payment.error_description ?? "Payment failed",
              })
              .eq("id", record.id)
              .eq("state", "created");
          }
        }

        return new Response("ok");
      },
    },
  },
});
