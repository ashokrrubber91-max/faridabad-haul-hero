/**
 * Addresses shown to people must read like addresses. When Google cannot return
 * a formatted address we still keep the real coordinates, but label the stop as
 * a map pin instead of dumping "28.40123, 77.31245" where an address belongs.
 */
const PIN_PREFIX = "Map pin";
const COORD_ONLY = /^\s*-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+\s*$/;

export function pinnedAddress(lat: number, lng: number, hint?: string): string {
  const label = hint?.trim() ? `${PIN_PREFIX} near ${hint.trim()}` : PIN_PREFIX;
  return `${label} (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
}

export function isPinOnlyAddress(address?: string | null): boolean {
  if (!address) return false;
  return COORD_ONLY.test(address) || address.startsWith(PIN_PREFIX);
}

/**
 * Splits a stored address into the human line and an optional coordinate line,
 * so drivers can read the address without opening navigation.
 */
export function addressLines(
  address?: string | null,
  lat?: number | null,
  lng?: number | null,
): { primary: string; secondary: string | null } {
  const text = (address ?? "").trim();
  const coords =
    typeof lat === "number" && typeof lng === "number"
      ? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
      : null;

  if (!text) {
    return {
      primary: coords ? "Map pin location — address not provided" : "Address not provided",
      secondary: coords,
    };
  }
  if (COORD_ONLY.test(text)) {
    return { primary: "Map pin location — no street address", secondary: text };
  }
  if (text.startsWith(PIN_PREFIX)) {
    const inside = text.match(/\(([^)]+)\)/)?.[1] ?? coords;
    return { primary: text.replace(/\s*\([^)]*\)\s*$/, ""), secondary: inside ?? null };
  }
  return { primary: text, secondary: coords };
}
