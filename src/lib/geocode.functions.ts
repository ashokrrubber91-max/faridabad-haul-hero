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

const sessionToken = z.string().trim().min(8).max(64);

/** Address suggestions for the pickup/drop search sheet. */
export const searchPlaces = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ input: z.string().trim().min(2).max(200), sessionToken }).parse(input),
  )
  .handler(async ({ data }) => {
    const { placeSuggestionsServer } = await import("@/lib/geocode.server");
    return { suggestions: await placeSuggestionsServer(data.input, data.sessionToken) };
  });

/** Exact point for a chosen suggestion — a booking needs real coordinates. */
export const getPlaceDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ placeId: z.string().trim().min(4).max(300), sessionToken }).parse(input),
  )
  .handler(async ({ data }) => {
    const { placeDetailsServer } = await import("@/lib/geocode.server");
    return { place: await placeDetailsServer(data.placeId, data.sessionToken) };
  });
