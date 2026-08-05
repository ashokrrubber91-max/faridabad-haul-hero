import { createFileRoute } from "@tanstack/react-router";

/**
 * Razorpay webhook — the authoritative source of payment truth.
 * Subscribe to `payment.captured` and `payment.failed` in the Razorpay dashboard
 * and set the same signing secret as RAZORPAY_WEBHOOK_SECRET.
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
          payload?: { payment?: { entity?: { id?: string; order_id?: string; method?: string; error_description?: string; amount?: number } } };
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
          .select("id, booking_id, state")
          .eq("provider_order_id", entity.order_id)
          .maybeSingle();
        if (!record) return new Response("ok");

        if (event.event === "payment.captured") {
          if (record.state !== "paid") {
            await supabaseAdmin
              .from("payments")
              .update({
                state: "paid",
                provider_payment_id: entity.id ?? null,
                method: entity.method ?? null,
              })
              .eq("id", record.id);
            if (record.booking_id) {
              await supabaseAdmin
                .from("bookings")
                .update({ payment_status: "paid" })
                .eq("id", record.booking_id);
            }
          }
        } else if (event.event === "payment.failed") {
          if (record.state === "created") {
            await supabaseAdmin
              .from("payments")
              .update({
                state: "failed",
                provider_payment_id: entity.id ?? null,
                error: entity.error_description ?? "Payment failed",
              })
              .eq("id", record.id);
          }
        }

        return new Response("ok");
      },
    },
  },
});
