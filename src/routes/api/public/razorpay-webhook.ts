import { createFileRoute } from "@tanstack/react-router";

/**
 * Razorpay webhook — authoritative payment notification, with database-side
 * amount/order/customer consistency checks before settlement.
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

        let event: {
          event?: string;
          payload?: {
            payment?: {
              entity?: {
                id?: string;
                order_id?: string;
                method?: string;
                error_description?: string;
                amount?: number;
                currency?: string;
                status?: string;
              };
            };
          };
        };
        try {
          event = JSON.parse(rawBody);
        } catch {
          return new Response("Bad payload", { status: 400 });
        }

        const entity = event.payload?.payment?.entity;
        if (!entity?.order_id) return new Response("ok");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: record } = await supabaseAdmin
          .from("payments")
          .select("id, booking_id, customer_id, amount, currency, state, provider_payment_id")
          .eq("provider_order_id", entity.order_id)
          .maybeSingle();
        if (!record) return new Response("ok");

        const { data: booking } = record.booking_id
          ? await supabaseAdmin
              .from("bookings")
              .select("id, customer_id, fare, payment_status")
              .eq("id", record.booking_id)
              .maybeSingle()
          : { data: null };

        if (event.event === "payment.captured") {
          const amountMatches = typeof entity.amount === "number" && Math.abs(entity.amount / 100 - Number(record.amount)) < 0.01;
          const currencyMatches = (entity.currency ?? "INR") === "INR" && record.currency === "INR";
          const bookingMatches = !!booking && booking.customer_id === record.customer_id && Number(booking.fare) === Number(record.amount);
          if (entity.status !== "captured" || !amountMatches || !currencyMatches || !bookingMatches) {
            return new Response("Payment consistency check failed", { status: 409 });
          }

          if (record.state === "paid") return new Response("ok");

          const { data: settled, error: paymentError } = await supabaseAdmin
            .from("payments")
            .update({ state: "paid", provider_payment_id: entity.id ?? null, method: entity.method ?? null })
            .eq("id", record.id)
            .eq("state", "created")
            .select("id")
            .maybeSingle();
          if (paymentError) return new Response("Settlement failed", { status: 500 });
          if (!settled) return new Response("ok");

          if (record.booking_id) {
            const { error: bookingError } = await supabaseAdmin
              .from("bookings")
              .update({ payment_status: "paid" })
              .eq("id", record.booking_id)
              .eq("customer_id", record.customer_id);
            if (bookingError) return new Response("Booking settlement failed", { status: 500 });
          }
        } else if (event.event === "payment.failed") {
          if (record.state === "created") {
            await supabaseAdmin
              .from("payments")
              .update({ state: "failed", provider_payment_id: entity.id ?? null, error: entity.error_description ?? "Payment failed" })
              .eq("id", record.id)
              .eq("state", "created");
          }
        }

        return new Response("ok");
      },
    },
  },
});
