import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Firebase web config + VAPID public key. Both are publishable client values. */
export const getPushConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { getWebPushConfig } = await import("@/lib/push.server");
    const push = getWebPushConfig();
    if (!push) return { configured: false as const };
    return { configured: true as const, config: push.config, vapidKey: push.vapidKey };
  });

export const registerDeviceToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        token: z.string().min(20).max(500),
        platform: z.enum(["web", "android", "ios"]).default("web"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("device_tokens").upsert(
      {
        user_id: context.userId,
        token: data.token,
        platform: data.platform,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "token" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeDeviceToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ token: z.string().min(20).max(500) }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("device_tokens").delete().eq("token", data.token);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Fired by the customer app right after a booking is created. */
export const notifyDriversOfNewBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ bookingId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: booking, error } = await context.supabase
      .from("bookings")
      .select("id, customer_id")
      .eq("id", data.bookingId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!booking || booking.customer_id !== context.userId) throw new Error("Booking not found");

    const { alertDriversAboutBooking } = await import("@/lib/driver-alerts.server");
    return alertDriversAboutBooking(booking.id);
  });
