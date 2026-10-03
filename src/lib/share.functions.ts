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
    return (view ?? { ok: false, reason: "not_found" }) as SharedTrip;
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
      created_at: string;
      expires_at: string;
    };
