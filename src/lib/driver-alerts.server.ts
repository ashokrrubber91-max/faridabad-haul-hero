/** Server-only push delivery for new ride requests. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToTokens } from "./push.server";
import {
  DEFAULT_SERVICE_ZONE,
  resolveDriverVehicleType,
  selectMatchedDriverIds,
} from "./dispatch-match";

/** Optional schema supplied by the unapplied sequential-dispatch migration. */
type DispatchDatabase = {
  public: {
    Tables: {
      booking_dispatch_offers: {
        Row: { booking_id: string; driver_id: string; status: string; expires_at: string };
        Insert: { booking_id: string; driver_id: string; status: string; expires_at: string };
        Update: { booking_id?: string; driver_id?: string; status?: string; expires_at?: string };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};

export type DispatchTarget =
  { mode: "offer"; driverId: string } | { mode: "no_offer" } | { mode: "not_installed" };

/**
 * Sequential dispatch target for a booking. "not_installed" means the optional
 * dispatch table is absent, so callers fall back to zone/vehicle matching.
 */
export async function getDispatchTarget(
  client: SupabaseClient<DispatchDatabase>,
  bookingId: string,
): Promise<DispatchTarget> {
  const { data: offers, error } = await client
    .from("booking_dispatch_offers")
    .select("driver_id")
    .eq("booking_id", bookingId)
    .eq("status", "offered")
    .gt("expires_at", new Date().toISOString())
    .limit(1);

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return { mode: "not_installed" };
    }
    throw new Error(error.message);
  }
  const driverId = offers?.[0]?.driver_id;
  return driverId ? { mode: "offer", driverId } : { mode: "no_offer" };
}

export async function getOfferedDriverId(
  client: SupabaseClient<DispatchDatabase>,
  bookingId: string,
): Promise<string | null> {
  const target = await getDispatchTarget(client, bookingId);
  return target.mode === "offer" ? target.driverId : null;
}

type AdminClient = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

/** Online, verified, same-zone drivers of the requested vehicle who have not passed. */
async function findMatchedDriverIds(
  admin: AdminClient,
  booking: {
    id: string;
    status: string;
    driver_id: string | null;
    cancelled_at: string | null;
    service_zone: string | null;
    vehicle_type: string;
    expires_at: string | null;
  },
): Promise<string[]> {
  const zone = booking.service_zone || DEFAULT_SERVICE_ZONE;
  const { data: online, error: onlineError } = await admin
    .from("profiles")
    .select("id, service_zone")
    .eq("is_online", true)
    .eq("kyc_status", "approved")
    .eq("service_zone", zone)
    .limit(500);
  if (onlineError) throw new Error(onlineError.message);
  const ids = (online ?? []).map((p) => p.id);
  if (ids.length === 0) return [];

  const [roles, kyc, driverProfiles, catalogue, passes] = await Promise.all([
    admin.from("user_roles").select("user_id").eq("role", "driver").in("user_id", ids),
    admin.from("driver_kyc").select("driver_id, status, vehicle_id").in("driver_id", ids),
    admin.from("driver_profiles").select("user_id, vehicle_type").in("user_id", ids),
    admin.from("vehicle_types").select("id"),
    admin.from("driver_booking_passes").select("driver_id").eq("booking_id", booking.id),
  ]);
  for (const r of [roles, kyc, driverProfiles, catalogue, passes]) {
    if (r.error) throw new Error(r.error.message);
  }
  const driverIds = new Set((roles.data ?? []).map((r) => r.user_id));
  const kycById = new Map((kyc.data ?? []).map((k) => [k.driver_id, k]));
  const vehicleById = new Map((driverProfiles.data ?? []).map((d) => [d.user_id, d.vehicle_type]));
  const catalogueIds = (catalogue.data ?? []).map((v) => v.id);
  const passed = new Set((passes.data ?? []).map((p) => p.driver_id));

  const candidates = (online ?? [])
    .filter((p) => driverIds.has(p.id))
    .map((p) => {
      const k = kycById.get(p.id);
      return {
        id: p.id,
        isOnline: true,
        kycApproved: k?.status === "approved",
        serviceZone: p.service_zone,
        vehicleType: resolveDriverVehicleType(vehicleById.get(p.id), k?.vehicle_id, catalogueIds),
      };
    });
  return selectMatchedDriverIds(booking, candidates, passed);
}

/** The closest eligible drivers (database ranks by distance from the pickup). */
async function findNearestDriverIds(admin: AdminClient, bookingId: string): Promise<string[]> {
  const rpc = admin.rpc.bind(admin) as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: { driver_id: string }[] | null; error: { message: string } | null }>;
  const { data, error } = await rpc("nearest_dispatch_drivers", {
    _booking_id: bookingId,
    _limit: 15,
  });
  // A missing function or any lookup failure must never block ride alerts.
  if (error) return [];
  return (data ?? []).map((r) => r.driver_id);
}

export async function alertDriversAboutBooking(
  bookingId: string,
): Promise<{ sent: number; failed: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: booking } = await supabaseAdmin
    .from("bookings")
    .select(
      "id, pickup_address, drop_address, fare, distance_km, status, driver_id, cancelled_at, service_zone, vehicle_type, expires_at",
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (!booking || booking.status !== "pending" || booking.driver_id || booking.cancelled_at) {
    return { sent: 0, failed: 0 };
  }

  // When sequential dispatch is installed, only the driver holding the live
  // offer is notified. Without it, notify every online, verified driver in the
  // booking's zone who drives the requested vehicle type.
  // Keep the optional table's schema local; generated live-database types stay unchanged.
  const target = await getDispatchTarget(
    supabaseAdmin as unknown as SupabaseClient<DispatchDatabase>,
    bookingId,
  );
  let driverIds: string[];
  if (target.mode === "offer") driverIds = [target.driverId];
  else if (target.mode === "no_offer") driverIds = [];
  else {
    // Nearest drivers first (live locations); fall back to zone/vehicle matching
    // when the booking has no pickup coordinates or no driver has a fresh location.
    driverIds = await findNearestDriverIds(supabaseAdmin, bookingId);
    if (driverIds.length === 0) driverIds = await findMatchedDriverIds(supabaseAdmin, booking);
  }
  if (driverIds.length === 0) return { sent: 0, failed: 0 };

  const { data: tokenRows, error: tokenError } = await supabaseAdmin
    .from("device_tokens")
    .select("token")
    .in("user_id", driverIds);
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
