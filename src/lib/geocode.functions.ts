import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Turns a real device/pin coordinate into a human-readable address. Signed-in
 * only: keeps the metered Geocoding API off the open internet.
 */
export const reverseGeocode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { reverseGeocodeServer } = await import("@/lib/geocode.server");
    return { address: await reverseGeocodeServer(data.lat, data.lng) };
  });
