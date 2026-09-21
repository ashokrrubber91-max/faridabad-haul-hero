import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Reports whether WhatsApp messaging is actually switched on. Only booleans
 * leave the server — never a credential value.
 */
export const getWhatsAppStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { isWhatsAppConfigured, isWebhookVerifiable, whatsappFrom } =
      await import("@/lib/whatsapp.server");
    return {
      sending: isWhatsAppConfigured(),
      signatureVerification: isWebhookVerifiable(),
      senderConfigured: whatsappFrom() !== null,
      aiUnderstanding: !!process.env["LOVABLE_API_KEY"]?.trim(),
    };
  });
