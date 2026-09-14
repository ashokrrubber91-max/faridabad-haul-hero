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

export type PlaceSuggestion = {
  placeId: string;
  primary: string;
  secondary: string | null;
};

/** Faridabad-biased address suggestions. Empty list when Places is unavailable. */
export async function placeSuggestionsServer(
  input: string,
  sessionToken: string,
): Promise<PlaceSuggestion[]> {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const mapsKey = process.env["GOOGLE_MAPS_API_KEY"];
  if (!lovableKey || !mapsKey) return [];

  const response = await fetch(`${GATEWAY_URL}/places/v1/places:autocomplete`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": mapsKey,
      "Content-Type": "application/json",
      "X-Goog-FieldMask":
        "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat",
    },
    body: JSON.stringify({
      input,
      sessionToken,
      includedRegionCodes: ["in"],
      locationBias: {
        circle: { center: { latitude: 28.4089, longitude: 77.3178 }, radius: 25000 },
      },
    }),
  });

  if (!response.ok) {
    console.error(`Places autocomplete failed [${response.status}]: ${await response.text()}`);
    return [];
  }

  const payload = (await response.json()) as {
    suggestions?: Array<{
      placePrediction?: {
        placeId?: string;
        structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
      };
    }>;
  };
  return (payload.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => !!p?.placeId && !!p.structuredFormat?.mainText?.text)
    .map((p) => ({
      placeId: p.placeId!,
      primary: p.structuredFormat!.mainText!.text!,
      secondary: p.structuredFormat?.secondaryText?.text ?? null,
    }))
    .slice(0, 8);
}

/** Exact coordinates + formatted address for a chosen suggestion. */
export async function placeDetailsServer(
  placeId: string,
  sessionToken: string,
): Promise<{ address: string; lat: number; lng: number } | null> {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const mapsKey = process.env["GOOGLE_MAPS_API_KEY"];
  if (!lovableKey || !mapsKey) return null;

  const response = await fetch(
    `${GATEWAY_URL}/places/v1/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`,
    {
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": mapsKey,
        "X-Goog-FieldMask": "formattedAddress,location,displayName",
      },
    },
  );
  if (!response.ok) {
    console.error(`Place details failed [${response.status}]: ${await response.text()}`);
    return null;
  }
  const payload = (await response.json()) as {
    formattedAddress?: string;
    displayName?: { text?: string };
    location?: { latitude?: number; longitude?: number };
  };
  const lat = payload.location?.latitude;
  const lng = payload.location?.longitude;
  const address = payload.formattedAddress ?? payload.displayName?.text;
  if (typeof lat !== "number" || typeof lng !== "number" || !address) return null;
  return { address, lat, lng };
}
