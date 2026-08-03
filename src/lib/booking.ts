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

export const STATUS_META: Record<string, { label: string; tone: "warning" | "primary" | "success" | "muted" | "destructive" }> = {
  pending: { label: "Awaiting driver", tone: "warning" },
  accepted: { label: "Driver assigned", tone: "primary" },
  in_progress: { label: "On the way", tone: "primary" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "destructive" },
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

/** Road-adjusted distance across a route with intermediate waypoints (pickup -> stops -> drop). */
export function routeDistanceKm(points: LatLng[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += haversineKm(points[i], points[i + 1]);
  }
  return Math.max(0.5, +(total * 1.3).toFixed(1));
}

export const VEHICLE_DETAILS: Record<VehicleId, { weightLimit: string; loadArea: string; goodTor: string[] }> = {
  tata_ace: {
    weightLimit: "750 kg",
    loadArea: "6.5 x 4.5 ft open bed",
    goodTor: ["Small household shifting", "Boxes & cartons", "Appliances"],
  },
  pickup_8ft: {
    weightLimit: "1.2 ton",
    loadArea: "8 x 5 ft open bed",
    goodTor: ["Furniture", "Construction material", "Multi-room shifting"],
  },
  tata_407: {
    weightLimit: "2.5 ton",
    loadArea: "9 x 5.5 ft closed body",
    goodTor: ["Bulk goods", "Commercial cargo", "Office relocation"],
  },
};
