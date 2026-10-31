/**
 * Pure ride-alert matching shared by the driver app (instant pop-up) and the
 * server push fallback. A driver is alerted only when they are verified,
 * online, in the booking's service zone and drive the requested vehicle type.
 */

export const DEFAULT_SERVICE_ZONE = "Faridabad";

export type DriverDispatchContext = {
  isOnline: boolean;
  kycApproved: boolean;
  serviceZone: string | null | undefined;
  vehicleType: string | null | undefined;
};

export type DispatchBooking = {
  status: string | null | undefined;
  driver_id: string | null | undefined;
  cancelled_at?: string | null;
  service_zone?: string | null;
  vehicle_type: string | null | undefined;
  expires_at?: string | null;
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
  return booking.vehicle_type === driver.vehicleType;
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
