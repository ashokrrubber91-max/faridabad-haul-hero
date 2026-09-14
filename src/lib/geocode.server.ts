/**
 * Reverse geocoding through the Google Maps connector gateway.
 *
 * Server-only on purpose: the managed browser key is authorised for map tiles
 * only, so the browser Geocoder returns REQUEST_DENIED and every "Use my
 * location" reading would degrade to bare coordinates. The gateway uses the
 * server key instead. Never invents an address — callers get null and show the
 * pin coordinates honestly.
 */

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

export async function reverseGeocodeServer(lat: number, lng: number): Promise<string | null> {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const mapsKey = process.env["GOOGLE_MAPS_API_KEY"];
  if (!lovableKey || !mapsKey) return null;

  const response = await fetch(
    `${GATEWAY_URL}/maps/api/geocode/json?latlng=${lat},${lng}&region=in`,
    {
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": mapsKey,
      },
    },
  );

  if (response.status === 403) {
    const details: Array<{ reason?: string }> =
      (
        (await response.json().catch(() => null)) as {
          error?: { details?: Array<{ reason?: string }> };
        } | null
      )?.error?.details ?? [];
    const reason = details.find((d) => d.reason)?.reason;
    console.error(`Geocoding denied (403) reason=${reason ?? "unknown"}`);
    return null;
  }
  if (!response.ok) {
    console.error(`Geocoding failed [${response.status}]: ${await response.text()}`);
    return null;
  }

  const payload = (await response.json()) as {
    status?: string;
    results?: Array<{ formatted_address?: string }>;
  };
  if (payload.status !== "OK") {
    if (payload.status !== "ZERO_RESULTS") console.error(`Geocoding status ${payload.status}`);
    return null;
  }
  const address = payload.results?.[0]?.formatted_address;
  return typeof address === "string" && address.trim() ? address.trim() : null;
}
