import { reverseGeocode } from "@/lib/geocode.functions";

/**
 * One place that turns real coordinates into a readable address.
 *
 * The server (connector gateway) is asked first because the browser map key is
 * not authorised for geocoding. If the lookup fails we return null so callers
 * can show the pin coordinates plainly instead of inventing a street address.
 */
export async function lookupAddress(lat: number, lng: number): Promise<string | null> {
  try {
    const { address } = await reverseGeocode({ data: { lat, lng } });
    return address ?? null;
  } catch {
    return null;
  }
}
