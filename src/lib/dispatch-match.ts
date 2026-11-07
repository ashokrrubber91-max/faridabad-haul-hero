/**
 * Pure ride-alert matching shared by the driver app (instant pop-up) and the
 * server push fallback. A driver is alerted only when they are verified,
 * online, in the booking's service zone and drive the requested vehicle type.
 */

export const DEFAULT_SERVICE_ZONE = "Faridabad";

/**
 * Distance windows: a ride opens to nearby drivers first and widens with age.
 * Mirrors the database rule enforced by accept_booking (dispatch_radius_km).
 */
export const DISPATCH_WINDOWS: ReadonlyArray<{ untilSeconds: number; km: number }> = [
  { untilSeconds: 20, km: 3 },
  { untilSeconds: 40, km: 6 },
  { untilSeconds: 60, km: 10 },
];
/** A driver location older than this counts as unknown. */
export const LOCATION_FRESH_MS = 5 * 60 * 1000;

/** Radius in km for a ride of this age, or null once it is open to every matching driver. */
export function dispatchRadiusKm(ageSeconds: number): number | null {
  for (const w of DISPATCH_WINDOWS) if (ageSeconds < w.untilSeconds) return w.km;
  return null;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

export type DriverLocationFix = { lat: number; lng: number; updatedAt: string | number };

export type DriverDispatchContext = {
  isOnline: boolean;
  kycApproved: boolean;
  serviceZone: string | null | undefined;
  vehicleType: string | null | undefined;
  /**
   * undefined = location not tracked here (no distance rule applied);
   * null = tracked but unknown, so the driver waits for the open-to-all stage.
   */
  location?: DriverLocationFix | null;
};

export type DispatchBooking = {
  status: string | null | undefined;
  driver_id: string | null | undefined;
  cancelled_at?: string | null;
  service_zone?: string | null;
  vehicle_type: string | null | undefined;
  expires_at?: string | null;
  created_at?: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
};

/**
 * The driver's vehicle type: the driver profile value first, then the vehicle
 * chosen during verification. Values that are not catalogue ids (for example
 * an old registration number typed into the field) are treated as unknown.
 */
export function resolveDriverVehicleType(
  profileVehicle: string | null | undefined,
  kycVehicle: string | null | undefined,
  catalogueIds: Iterable<string>,
): string | null {
  const ids = new Set(catalogueIds);
  for (const candidate of [profileVehicle, kycVehicle]) {
    const value = candidate?.trim();
    if (value && ids.has(value)) return value;
  }
  return null;
}

/** True when this driver is inside the ride's current distance window. */
export function isDriverInDispatchWindow(
  booking: DispatchBooking,
  driver: DriverDispatchContext,
  now: number = Date.now(),
): boolean {
  if (driver.location === undefined) return true;
  if (!booking.created_at || booking.pickup_lat == null || booking.pickup_lng == null) return true;
  const created = new Date(booking.created_at).getTime();
  if (Number.isNaN(created)) return true;
  const radius = dispatchRadiusKm(Math.max(0, (now - created) / 1000));
  if (radius === null) return true;
  const loc = driver.location;
  if (!loc) return false;
  const seen = typeof loc.updatedAt === "number" ? loc.updatedAt : new Date(loc.updatedAt).getTime();
  if (Number.isNaN(seen) || now - seen > LOCATION_FRESH_MS) return false;
  return haversineKm(loc.lat, loc.lng, booking.pickup_lat, booking.pickup_lng) <= radius;
}

export function isRideAlertMatch(
  booking: DispatchBooking,
  driver: DriverDispatchContext,
  now: number = Date.now(),
): boolean {
  if (!driver.isOnline || !driver.kycApproved || !driver.vehicleType) return false;
  if (booking.status !== "pending" || booking.driver_id || booking.cancelled_at) return false;
  if (booking.expires_at && new Date(booking.expires_at).getTime() <= now) return false;
  const bookingZone = booking.service_zone || DEFAULT_SERVICE_ZONE;
  const driverZone = driver.serviceZone || DEFAULT_SERVICE_ZONE;
  if (bookingZone !== driverZone) return false;
  if (booking.vehicle_type !== driver.vehicleType) return false;
  return isDriverInDispatchWindow(booking, driver, now);
}

export type CandidateDriver = DriverDispatchContext & { id: string };

/** Drivers to notify for a booking, excluding anyone who already passed on it. */
export function selectMatchedDriverIds(
  booking: DispatchBooking,
  drivers: CandidateDriver[],
  passedDriverIds: Set<string> = new Set(),
  now: number = Date.now(),
): string[] {
  return drivers
    .filter((d) => !passedDriverIds.has(d.id) && isRideAlertMatch(booking, d, now))
    .map((d) => d.id);
}
