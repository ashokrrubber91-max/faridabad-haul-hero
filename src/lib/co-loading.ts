/** Pure planning rules only. Financial writes and assignment require an atomic backend capability. */
export type SharedLoad = {
  bookingId: string;
  customerId: string;
  vehicleId: string;
  weightKg: number;
  standardFare: number;
  optedIn: boolean;
};
export type LoadStop = { bookingId: string; kind: "pickup" | "drop" };

export function remainingLoadCapacity(weightKg: number, capacityKg: number): number | null {
  return Number.isFinite(weightKg) &&
    Number.isFinite(capacityKg) &&
    weightKg > 0 &&
    weightKg < capacityKg
    ? capacityKg - weightKg
    : null;
}

export function sharedLoadFare(standardFare: number, matched: boolean): number {
  if (!Number.isFinite(standardFare) || standardFare < 0) throw new Error("Invalid standard fare");
  return Math.round(standardFare * (matched ? 0.75 : 1) * 100) / 100;
}

/** Every occupied route segment must fit. Each independent booking retains its own pickup/drop. */
export function canShareItinerary(
  loads: SharedLoad[],
  stops: LoadStop[],
  capacityKg: number,
): boolean {
  if (loads.length < 2 || !Number.isFinite(capacityKg) || capacityKg <= 0) return false;
  const first = loads[0];
  if (!first || new Set(loads.map((load) => load.bookingId)).size !== loads.length) return false;
  if (new Set(loads.map((load) => load.customerId)).size !== loads.length) return false;
  if (
    loads.some(
      (load) =>
        !load.optedIn ||
        load.vehicleId !== first.vehicleId ||
        remainingLoadCapacity(load.weightKg, capacityKg) === null,
    )
  )
    return false;
  const onboard = new Set<string>();
  const delivered = new Set<string>();
  let occupied = 0;
  for (const stop of stops) {
    const load = loads.find((row) => row.bookingId === stop.bookingId);
    if (!load || delivered.has(load.bookingId)) return false;
    if (stop.kind === "pickup") {
      if (onboard.has(load.bookingId)) return false;
      onboard.add(load.bookingId);
      occupied += load.weightKg;
      if (occupied > capacityKg) return false;
    } else {
      if (!onboard.delete(load.bookingId)) return false;
      occupied -= load.weightKg;
      delivered.add(load.bookingId);
    }
  }
  return onboard.size === 0 && delivered.size === loads.length;
}
