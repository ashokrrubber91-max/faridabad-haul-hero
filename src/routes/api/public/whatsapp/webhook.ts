import { createFileRoute } from "@tanstack/react-router";

/**
 * Twilio WhatsApp inbound webhook.
 *
 * Security: every delivery must carry a valid `X-Twilio-Signature` computed with
 * the account auth token. Without the token configured we refuse callbacks
 * rather than trust unauthenticated input.
 *
 * Idempotency: the provider message SID is stored with a unique constraint
 * before anything is processed, so Twilio's retries can never create a second
 * booking draft, task or reply.
 */

function twiml(message?: string) {
  const body = message
    ? `<Response><Message>${message
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")}</Message></Response>`
    : "<Response/>";
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/whatsapp/webhook")({
  server: {
    handlers: {
      // Health probe for ops: confirms the endpoint exists and whether sending
      // and signature verification are switched on. No secrets are returned.
      GET: async () => {
        const { isWhatsAppConfigured, isWebhookVerifiable } = await import("@/lib/whatsapp.server");
        return new Response(
          JSON.stringify({
            endpoint: "whatsapp-webhook",
            method: "POST",
            sending_configured: isWhatsAppConfigured(),
            signature_verification: isWebhookVerifiable(),
          }),
          { status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
        );
      },

      POST: async ({ request }) => {
        const { verifyTwilioSignature, isWebhookVerifiable, bareE164, last10, sendWhatsApp } =
          await import("@/lib/whatsapp.server");

        if (!isWebhookVerifiable()) {
          return new Response("WhatsApp webhook is not configured", { status: 503 });
        }

        const raw = await request.text();
        const form = new URLSearchParams(raw);
        const params: Record<string, string> = {};
        for (const [k, v] of form.entries()) params[k] = v;

        const signature = request.headers.get("x-twilio-signature") ?? "";
        // Twilio signs the exact public URL it was configured with.
        const url = new URL(request.url);
        const configured = process.env["TWILIO_WEBHOOK_URL"]?.trim();
        const candidates = configured ? [configured, url.toString()] : [url.toString()];
        let verified = false;
        for (const candidate of candidates) {
          if (await verifyTwilioSignature(candidate, params, signature)) {
            verified = true;
            break;
          }
        }
        if (!verified) return new Response("Invalid signature", { status: 401 });

        const sid = params["MessageSid"] ?? params["SmsMessageSid"] ?? "";
        const from = params["From"] ?? "";
        if (!sid || !from) return new Response("Bad payload", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const phone = last10(from);
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("id, phone")
          .eq("phone", phone)
          .maybeSingle();

        let role: "customer" | "driver" | "admin" | null = null;
        if (profile) {
          const { data: roles } = await supabaseAdmin
            .from("user_roles")
            .select("role")
            .eq("user_id", profile.id);
          const owned = (roles ?? []).map((r) => r.role);
          role = owned.includes("admin")
            ? "admin"
            : owned.includes("driver")
              ? "driver"
              : "customer";
        }

        const lat = Number(params["Latitude"]);
        const lng = Number(params["Longitude"]);

        // Durable receipt first — the unique SID makes retries harmless.
        const { data: stored, error: storeError } = await supabaseAdmin
          .from("whatsapp_messages")
          .insert({
            provider_sid: sid,
            direction: "inbound",
            from_phone: bareE164(from),
            to_phone: bareE164(params["To"] ?? ""),
            user_id: profile?.id ?? null,
            sender_role: role,
            body: params["Body"] ?? "",
            num_media: Number(params["NumMedia"] ?? 0) || 0,
            latitude: Number.isFinite(lat) ? lat : null,
            longitude: Number.isFinite(lng) ? lng : null,
            payload: params,
          })
          .select("id")
          .single();

        if (storeError) {
          // Unique violation => Twilio retried a message we already handled.
          if (storeError.code === "23505") return twiml();
          console.error("[whatsapp] inbox write failed:", storeError.message);
          return new Response("Not stored", { status: 500 });
        }

        let reply = "";
        let intent = "error";
        try {
          const { handleInboundWhatsApp } = await import("@/lib/whatsapp-handler.server");
          const result = await handleInboundWhatsApp(supabaseAdmin, {
            id: stored.id,
            from_phone: bareE164(from),
            body: params["Body"] ?? "",
            latitude: Number.isFinite(lat) ? lat : null,
            longitude: Number.isFinite(lng) ? lng : null,
            user_id: profile?.id ?? null,
            sender_role: role,
          });
          reply = result.reply;
          intent = result.intent;
          await supabaseAdmin
            .from("whatsapp_messages")
            .update({ processed_at: new Date().toISOString(), intent })
            .eq("id", stored.id);
        } catch (e) {
          const messageText = e instanceof Error ? e.message : "Processing failed";
          console.error("[whatsapp] processing failed:", messageText);
          await supabaseAdmin
            .from("whatsapp_messages")
            .update({ processing_error: messageText })
            .eq("id", stored.id);
          // Leave the row unprocessed and let Twilio retry.
          return new Response("Processing failed", { status: 500 });
        }

        if (!reply) return twiml();

        // Reply on the same webhook response (no extra API call, no billing
        // surprise); log it so ops can see the whole conversation.
        await supabaseAdmin.from("whatsapp_outbound").insert({
          to_phone: bareE164(from),
          body: reply,
          status: "sent",
          in_reply_to: stored.id,
          user_id: profile?.id ?? null,
        });

        // TwiML replies are limited to 1600 characters; anything longer goes out
        // as a separate API message.
        if (reply.length > 1500) {
          await sendWhatsApp(bareE164(from), reply);
          return twiml();
        }
        return twiml(reply);
      },
    },
  },
});
