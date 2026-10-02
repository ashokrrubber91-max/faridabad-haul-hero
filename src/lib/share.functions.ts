import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Public read for a shared trip link. The token is resolved on the server so the
 * lookup is never callable by anonymous visitors directly, and the database
 * function returns only safe fields — no phone numbers, codes or fare details.
 */
export const getSharedTrip = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ token: z.string().min(16).max(128) }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: view, error } = await supabaseAdmin.rpc("shared_trip_view", {
      _token: data.token,
    });
    if (error) throw new Error(error.message);
    const shared = (view ?? { ok: false, reason: "not_found" }) as SharedTrip;
    if (!shared.ok || !shared.driver_location) return shared;

    const target =
      shared.status === "accepted" ? shared.pickup : shared.drop;
    if (
      typeof target.lat !== "number" ||
      typeof target.lng !== "number" ||
      !Number.isFinite(target.lat) ||
      !Number.isFinite(target.lng)
    ) {
      return shared;
    }

    try {
      const { computeRoadRouteServer } = await import("@/lib/routing.server");
      const route = await computeRoadRouteServer([
        { lat: shared.driver_location.lat, lng: shared.driver_location.lng },
        { lat: target.lat, lng: target.lng },
      ]);
      return { ...shared, live_route: route };
    } catch {
      // The public share link must still work when routing is temporarily unavailable.
      return shared;
    }
  });

export type SharedTrip =
  | { ok: false; reason: "not_found" | "revoked" | "expired" }
  | {
      ok: true;
      status: string;
      pickup_address: string;
      drop_address: string;
      pickup: { lat: number | null; lng: number | null };
      drop: { lat: number | null; lng: number | null };
      distance_km: number | string;
      vehicle_label: string | null;
      driver_first_name: string | null;
      vehicle_number: string | null;
      driver_location: { lat: number; lng: number; updated_at: string } | null;
      live_route?: { distanceKm: number; durationMin: number; polyline: string } | null;
      created_at: string;
      expires_at: string;
    };
