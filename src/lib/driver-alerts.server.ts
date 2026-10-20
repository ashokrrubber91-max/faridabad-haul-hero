/** Server-only push delivery for the currently offered sequential driver. */
import { sendPushToTokens } from "./push.server";

export async function alertDriversAboutBooking(
  bookingId: string,
): Promise<{ sent: number; failed: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: booking } = await supabaseAdmin
    .from("bookings")
    .select("id, pickup_address, drop_address, fare, distance_km, status, driver_id, cancelled_at")
    .eq("id", bookingId)
    .maybeSingle();

  if (!booking || booking.status !== "pending" || booking.driver_id || booking.cancelled_at) {
    return { sent: 0, failed: 0 };
  }

  // Sequential dispatch must never notify every online driver. Only push to the
  // driver who currently owns a live offer; expired/declined offers are excluded.
  const { data: offers, error: offerError } = await supabaseAdmin
    .from("booking_dispatch_offers")
    .select("driver_id")
    .eq("booking_id", bookingId)
    .eq("status", "offered")
    .gt("expires_at", new Date().toISOString())
    .limit(1);
  if (offerError) throw new Error(offerError.message);
  const driverId = offers?.[0]?.driver_id;
  if (!driverId) return { sent: 0, failed: 0 };

  const { data: tokenRows, error: tokenError } = await supabaseAdmin
    .from("device_tokens")
    .select("token")
    .eq("user_id", driverId);
  if (tokenError) throw new Error(tokenError.message);

  const tokens = (tokenRows ?? []).map((t) => t.token);
  if (tokens.length === 0) return { sent: 0, failed: 0 };

  const result = await sendPushToTokens(tokens, {
    title: `New MiniPort ride · ₹${Number(booking.fare)}`,
    body: `${booking.pickup_address} → ${booking.drop_address} · Accept within 20 seconds.`,
    link: "/driver",
    data: { bookingId: booking.id, kind: "driver_ride_offer" },
  });

  if (result.invalidTokens.length > 0) {
    await supabaseAdmin.from("device_tokens").delete().in("token", result.invalidTokens);
  }

  return { sent: result.sent, failed: result.failed };
}

export async function alertCustomerAboutBooking(
  bookingId: string,
  title: string,
  body: string,
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: booking } = await supabaseAdmin
    .from("bookings")
    .select("customer_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking?.customer_id) return;
  const { data: tokenRows } = await supabaseAdmin
    .from("device_tokens")
    .select("token")
    .eq("user_id", booking.customer_id);
  const tokens = (tokenRows ?? []).map((t) => t.token);
  if (tokens.length === 0) return;
  await sendPushToTokens(tokens, {
    title,
    body,
    link: "/orders",
    data: { bookingId, kind: "status" },
  });
}
