/**
 * Real device geolocation with honest, actionable errors.
 *
 * Two rules keep Android/Chrome from showing "this site can't ask for your
 * permission": the permission prompt is only triggered from a direct user tap,
 * and we check the stored permission state first so a blocked device gets copy
 * that tells the person what to change instead of a silent failure.
 * No coordinates are ever invented.
 */
export type GeoFix = { lat: number; lng: number; accuracyM: number | null; at: number };

export type GeoFailure = {
  code: "unsupported" | "insecure" | "denied" | "unavailable" | "timeout" | "unknown";
  message: string;
};

export const GEO_MESSAGES: Record<GeoFailure["code"], string> = {
  unsupported: "This device or browser cannot share its location. Search or drop a pin instead.",
  insecure:
    "Location needs a secure (https) connection. Open MiniPort over https, or drop a pin on the map.",
  denied:
    "Location permission is blocked for MiniPort. Open your browser's site settings, allow Location, then tap Use my location again. You can also drop a pin on the map.",
  unavailable:
    "Your device could not get a GPS fix. Move to an open area with GPS on, or drop a pin on the map.",
  timeout: "Getting your location took too long. Try again, or drop a pin on the map.",
  unknown: "We could not read your location. Try again, or drop a pin on the map.",
};

export function isGeolocationSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.geolocation;
}

/** "granted" | "prompt" | "denied" | "unknown" — never throws. */
export async function readPermissionState(): Promise<"granted" | "prompt" | "denied" | "unknown"> {
  try {
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
    if (!perms?.query) return "unknown";
    const status = await perms.query({ name: "geolocation" as PermissionName });
    return status.state as "granted" | "prompt" | "denied";
  } catch {
    return "unknown";
  }
}

/**
 * Must be called straight from a user gesture (button tap) with no overlay
 * animation in flight, otherwise mobile browsers refuse to show the prompt.
 */
export async function getCurrentFix(
  options: PositionOptions = { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
): Promise<GeoFix> {
  if (!isGeolocationSupported()) throw failure("unsupported");
  if (
    typeof window !== "undefined" &&
    !window.isSecureContext &&
    window.location.hostname !== "localhost"
  ) {
    throw failure("insecure");
  }
  if ((await readPermissionState()) === "denied") throw failure("denied");

  return new Promise<GeoFix>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy ?? null,
          at: pos.timestamp,
        }),
      (err) =>
        reject(
          failure(
            err.code === err.PERMISSION_DENIED
              ? "denied"
              : err.code === err.TIMEOUT
                ? "timeout"
                : err.code === err.POSITION_UNAVAILABLE
                  ? "unavailable"
                  : "unknown",
          ),
        ),
      options,
    );
  });
}

export function geoMessage(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as GeoFailure).code;
    if (code in GEO_MESSAGES) return GEO_MESSAGES[code];
  }
  return GEO_MESSAGES.unknown;
}

/** A fix older than this is stale and must not be presented as live. */
export const STALE_FIX_MS = 90_000;

export function isStaleFix(updatedAt: string | number | null | undefined): boolean {
  if (!updatedAt) return true;
  const t = typeof updatedAt === "number" ? updatedAt : new Date(updatedAt).getTime();
  if (!Number.isFinite(t)) return true;
  return Date.now() - t > STALE_FIX_MS;
}

function failure(code: GeoFailure["code"]): GeoFailure {
  return { code, message: GEO_MESSAGES[code] };
}
