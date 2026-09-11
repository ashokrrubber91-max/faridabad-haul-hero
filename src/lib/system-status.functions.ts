import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Reports which external providers are actually configured, so the ops team
 * never assumes a channel works when its credentials are missing.
 * Only booleans leave the server — never any secret value.
 */
export const getSystemStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const has = (k: string) => !!process.env[k]?.trim();

    return {
      payments: {
        keys: has("RAZORPAY_KEY_ID") && has("RAZORPAY_KEY_SECRET"),
        webhook: has("RAZORPAY_WEBHOOK_SECRET"),
      },
      push: {
        serviceAccount: has("FIREBASE_SERVICE_ACCOUNT_JSON"),
        webConfig: has("FIREBASE_WEB_CONFIG_JSON") && has("FIREBASE_VAPID_PUBLIC_KEY"),
      },
      maps: {
        server: has("GOOGLE_MAPS_API_KEY"),
        browser: has("GOOGLE_MAPS_BROWSER_KEY"),
      },
      sms: {
        provider:
          has("TWILIO_ACCOUNT_SID") && has("TWILIO_AUTH_TOKEN") && has("TWILIO_FROM_NUMBER"),
      },
      ai: { gateway: has("LOVABLE_API_KEY") },
    };
  });
