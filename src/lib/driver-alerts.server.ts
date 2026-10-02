/** Server-only fan-out of ride alerts to eligible drivers. */
import { sendPushToTokens } from "./push.server";

export async function alertDriversAboutBooking(
  bookingId: string,
): Promise<{ sent: number; failed: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: booking } = await supabaseAdmin
    .from("bookings")
    .select(
      "id, pickup_address, drop_address, fare, vehicle_type, distance_km, status, service_zone, driver_id, cancelled_at, pickup_lat, pickup_lng",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking || booking.status !== "pending" || booking.driver_id || booking.cancelled_at)
    return { sent: 0, failed: 0 };

  // Online drivers with approved KYC.
  const { data: driverProfiles } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("is_online", true)
    .eq("kyc_status", "approved")
    .eq("service_zone", booking.service_zone);
  const driverIds = (driverProfiles ?? []).map((p) => p.id);
  if (driverIds.length === 0) return { sent: 0, failed: 0 };

  const { data: roleRows } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("role", "driver")
    .in("user_id", driverIds);
  const eligible = (roleRows ?? []).map((r) => r.user_id);
  if (eligible.length === 0) return { sent: 0, failed: 0 };

  // Prefer the nearest recently-active drivers when pickup coordinates are available.
  // This is notification fan-out, not assignment: the existing server-authoritative
  // booking acceptance flow still decides who gets the trip.
  let notifyDriverIds = eligible;
  if (booking.pickup_lat != null && booking.pickup_lng != null) {
    const { data: locations } = await supabaseAdmin
      .from("driver_locations")
      .select("driver_id, latitude, longitude, updated_at")
      .in("driver_id", eligible)
      .gte("updated_at", new Date(Date.now() - 2 * 60 * 1000).toISOString());

    const toRad = (value: number) => (value * Math.PI) / 180;
    const distanceKm = (lat: number, lng: number) => {
      const dLat = toRad(lat - Number(booking.pickup_lat));
      const dLng = toRad(lng - Number(booking.pickup_lng));
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(Number(booking.pickup_lat))) *
          Math.cos(toRad(lat)) *
          Math.sin(dLng / 2) ** 2;
      return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    notifyDriverIds = [...(locations ?? [])]
      .filter((loc) => Number.isFinite(Number(loc.latitude)) && Number.isFinite(Number(loc.longitude)))
      .sort((a, b) =>
        distanceKm(Number(a.latitude), Number(a.longitude)) -
        distanceKm(Number(b.latitude), Number(b.longitude))
      )
      .slice(0, 10)
      .map((loc) => loc.driver_id);

    if (notifyDriverIds.length === 0) notifyDriverIds = eligible;
  }

  const { data: tokenRows } = await supabaseAdmin
    .from("device_tokens")
    .select("token")
    .in("user_id", notifyDriverIds);
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
  await sendPushToTokens(tokens, {
    title,
    body,
    link: "/orders",
    data: { bookingId, kind: "status" },
  });
}
