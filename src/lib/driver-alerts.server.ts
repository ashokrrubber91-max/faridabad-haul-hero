/** Server-only fan-out of ride alerts to eligible drivers. */
import { sendPushToTokens } from "./push.server";

export async function alertDriversAboutBooking(bookingId: string): Promise<{ sent: number; failed: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: booking } = await supabaseAdmin
    .from("bookings")
    .select("id, pickup_address, drop_address, fare, vehicle_type, distance_km, status")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking || booking.status !== "pending") return { sent: 0, failed: 0 };

  // Online drivers with approved KYC.
  const { data: driverProfiles } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("is_online", true)
    .eq("kyc_status", "approved");
  const driverIds = (driverProfiles ?? []).map((p) => p.id);
  if (driverIds.length === 0) return { sent: 0, failed: 0 };

  const { data: roleRows } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("role", "driver")
    .in("user_id", driverIds);
  const eligible = (roleRows ?? []).map((r) => r.user_id);
  if (eligible.length === 0) return { sent: 0, failed: 0 };

  const { data: tokenRows } = await supabaseAdmin
    .from("device_tokens")
    .select("token")
    .in("user_id", eligible);
  const tokens = (tokenRows ?? []).map((t) => t.token);
  if (tokens.length === 0) return { sent: 0, failed: 0 };

  const result = await sendPushToTokens(tokens, {
    title: `New trip · ₹${Number(booking.fare)}`,
    body: `${booking.pickup_address} → ${booking.drop_address} · ${Number(booking.distance_km)} km`,
    link: "/driver",
    data: { bookingId: booking.id, kind: "new_booking" },
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
  if (!booking) return;
  const { data: tokenRows } = await supabaseAdmin
    .from("device_tokens")
    .select("token")
    .eq("user_id", booking.customer_id);
  const tokens = (tokenRows ?? []).map((t) => t.token);
  if (tokens.length === 0) return;
  await sendPushToTokens(tokens, { title, body, link: "/orders", data: { bookingId, kind: "status" } });
}
