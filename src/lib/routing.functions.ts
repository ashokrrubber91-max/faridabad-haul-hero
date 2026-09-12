import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { estimateFare, VEHICLES, type VehicleId } from "@/lib/booking";

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

const vehicleIds = VEHICLES.map((v) => v.id) as [VehicleId, ...VehicleId[]];

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
        vehicle: z.enum(vehicleIds),
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
        fare: estimateFare(data.vehicle, route.distanceKm),
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
