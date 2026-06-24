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
