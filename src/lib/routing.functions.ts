import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const point = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const place = point.extend({
  address: z.string().trim().min(3).max(400),
  placeId: z.string().trim().max(300).nullish(),
  contactName: z.string().trim().max(120).nullish(),
  contactPhone: z.string().trim().max(20).nullish(),
});

/** Vehicles are configured in the database, so the id is validated by shape. */
const vehicleId = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]{2,40}$/);

/**
 * Authoritative road route for a set of waypoints. Used for the customer quote
 * and for live-trip geometry/ETA. Authenticated: keeps the paid routing API off
 * the public internet.
 */
export const computeRoadRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ points: z.array(point).min(2).max(6) }).parse(input))
  .handler(async ({ data }) => {
    const { computeRoadRouteServer } = await import("@/lib/routing.server");
    return computeRoadRouteServer(data.points);
  });

/**
 * Creates a booking with a server-computed road distance. The client never
 * supplies distance or fare: distance comes from the Routes API here and the
 * fare is recomputed by the database trigger from that distance.
 */
export const createBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        pickup: place,
        drop: place,
        stops: z.array(place).max(3).default([]),
        vehicle: vehicleId,
        couponCode: z.string().trim().max(40).nullable().default(null),
        coins: z.number().int().min(0).max(100000).default(0),
        paymentMethod: z.enum(["cod", "upi", "card", "netbanking", "wallet"]),
        notes: z.string().trim().max(2000).nullable().default(null),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { computeRoadRouteServer } = await import("@/lib/routing.server");
    const route = await computeRoadRouteServer([
      { lat: data.pickup.lat, lng: data.pickup.lng },
      ...data.stops.map((s) => ({ lat: s.lat, lng: s.lng })),
      { lat: data.drop.lat, lng: data.drop.lng },
    ]);

    // The vehicle's live rates come from the admin-managed catalogue. The
    // database trigger recomputes the fare from the same row, so this value can
    // never be used to underpay or overcharge.
    const { data: vt, error: vtError } = await context.supabase
      .from("vehicle_types")
      .select("base_fare, per_km_fare, active")
      .eq("id", data.vehicle)
      .maybeSingle();
    if (vtError) throw new Error(vtError.message);
    if (!vt || !vt.active) throw new Error("That vehicle is not available for booking right now.");

    const { data: booking, error } = await context.supabase
      .from("bookings")
      .insert({
        customer_id: context.userId,
        pickup_address: data.pickup.address,
        drop_address: data.drop.address,
        pickup_lat: data.pickup.lat,
        pickup_lng: data.pickup.lng,
        drop_lat: data.drop.lat,
        drop_lng: data.drop.lng,
        service_zone: "Faridabad",
        vehicle_type: data.vehicle,
        distance_km: route.distanceKm,
        fare: Math.round(Number(vt.base_fare) + Number(vt.per_km_fare) * route.distanceKm),
        coupon_code: data.couponCode,
        coins_redeemed: data.coins,
        payment_method: data.paymentMethod,
        notes: data.notes,
      })
      .select("id, fare, distance_km")
      .single();
    if (error) throw new Error(error.message);

    // Structured itinerary: sequence 0 = pickup, 1..3 = extra stops, 10 = drop.
    // Persisting stops properly replaces the old "Stops: ..." note text.
    const itinerary = [
      { seq: 0, kind: "pickup" as const, place: data.pickup },
      ...data.stops.map((s, i) => ({ seq: i + 1, kind: "stop" as const, place: s })),
      { seq: 10, kind: "drop" as const, place: data.drop },
    ];
    const { error: stopsError } = await context.supabase.from("booking_stops").insert(
      itinerary.map((row) => ({
        booking_id: booking.id,
        sequence: row.seq,
        kind: row.kind,
        address: row.place.address,
        latitude: row.place.lat,
        longitude: row.place.lng,
        place_id: row.place.placeId ?? null,
        contact_name: row.place.contactName ?? null,
        contact_phone: row.place.contactPhone ?? null,
      })),
    );
    if (stopsError) throw new Error(stopsError.message);

    return {
      id: booking.id,
      fare: Number(booking.fare),
      distanceKm: Number(booking.distance_km),
      durationMin: route.durationMin,
    };
  });
