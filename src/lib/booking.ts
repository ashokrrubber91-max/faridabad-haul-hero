export const VEHICLES = [
  { id: "tata_ace", label: "Tata Ace (Chhota Hathi)", capacity: "750 kg", base: 150, perKm: 22 },
  { id: "pickup_8ft", label: "Pickup 8ft", capacity: "1.2 ton", base: 220, perKm: 28 },
  { id: "tata_407", label: "Tata 407", capacity: "2.5 ton", base: 350, perKm: 38 },
] as const;

export type VehicleId = (typeof VEHICLES)[number]["id"];

export function estimateFare(vehicle: VehicleId, distanceKm: number): number {
  const v = VEHICLES.find((x) => x.id === vehicle);
  if (!v || !distanceKm || distanceKm < 0) return 0;
  return Math.round(v.base + v.perKm * distanceKm);
}

export function vehicleLabel(id: string): string {
  return VEHICLES.find((v) => v.id === id)?.label ?? id;
}

export const STATUS_META: Record<
  string,
  { label: string; tone: "warning" | "primary" | "success" | "muted" | "destructive" }
> = {
  pending: { label: "Awaiting driver", tone: "warning" },
  accepted: { label: "Driver assigned", tone: "primary" },
  in_progress: { label: "On the way", tone: "primary" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "destructive" },
  expired: { label: "Expired — no driver", tone: "muted" },
};

export type LatLng = { lat: number; lng: number };

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export const VEHICLE_DETAILS: Record<
  VehicleId,
  { weightLimit: string; loadArea: string; goodTor: string[] }
> = {
  tata_ace: {
    weightLimit: "750 kg",
    loadArea: "6.5 x 4.5 ft open bed",
    goodTor: ["Small household shifting", "Boxes & cartons", "Appliances"],
  },
  pickup_8ft: {
    weightLimit: "1200 kg",
    loadArea: "8 x 5 ft open bed",
    goodTor: ["Furniture", "Construction material", "Multi-room shifting"],
  },
  tata_407: {
    weightLimit: "2500 kg",
    loadArea: "9 x 5.5 ft closed body",
    goodTor: ["Bulk goods", "Commercial cargo", "Office relocation"],
  },
};

/**
 * Explicit booking columns for client queries. The 4-digit pickup/drop codes are
 * intentionally excluded — they are database-protected and only reachable through
 * the `get_booking_otps` (customer) and `verify_booking_otp` (driver) functions.
 */
export const BOOKING_FIELDS =
  "id, customer_id, driver_id, pickup_address, drop_address, vehicle_type, distance_km, fare, status, notes, created_at, updated_at, coupon_code, coupon_discount, coins_redeemed, payment_method, payment_status, commission_rate, commission_amount, driver_net_earning, pickup_verified_at, drop_verified_at, rating, review, pod_photo_url, cancellation_reason, pickup_lat, pickup_lng, drop_lat, drop_lng, loading_started_at, loading_stopped_at, unloading_started_at, unloading_stopped_at, service_zone, cancelled_at, expires_at";
