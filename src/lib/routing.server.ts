/**
 * Authoritative road routing through the Google Maps connector gateway
 * (Routes API). Server-only: the gateway credentials never reach the browser.
 */

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

export type RoutePoint = { lat: number; lng: number };

export type RoadRoute = {
  distanceKm: number;
  durationMin: number;
  /** Encoded road geometry from the Routes API. Never synthesised. */
  polyline: string;
};

function latLng(p: RoutePoint) {
  return { location: { latLng: { latitude: p.lat, longitude: p.lng } } };
}

/**
 * Computes a driving route for pickup -> stops -> drop. Throws when routing is
 * unavailable so callers can surface an honest failure instead of estimating.
 */
export async function computeRoadRouteServer(points: RoutePoint[]): Promise<RoadRoute> {
  if (points.length < 2) throw new Error("At least two points are needed for a route");

  const lovableKey = process.env["LOVABLE_API_KEY"];
  const mapsKey = process.env["GOOGLE_MAPS_API_KEY"];
  if (!lovableKey || !mapsKey) throw new Error("Maps routing is not configured");

  const origin = points[0]!;
  const destination = points[points.length - 1]!;
  const intermediates = points.slice(1, -1).map(latLng);

  const response = await fetch(`${GATEWAY_URL}/routes/directions/v2:computeRoutes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": mapsKey,
      "Content-Type": "application/json",
      "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
    },
    body: JSON.stringify({
      origin: latLng(origin),
      destination: latLng(destination),
      ...(intermediates.length ? { intermediates } : {}),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      regionCode: "IN",
      units: "METRIC",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Routes API failed [${response.status}]: ${body}`);
    throw new Error(`Road routing failed [${response.status}]`);
  }

  const payload = (await response.json()) as {
    routes?: Array<{
      distanceMeters?: number;
      duration?: string;
      polyline?: { encodedPolyline?: string };
    }>;
  };
  const route = payload.routes?.[0];
  const meters = route?.distanceMeters;
  const encoded = route?.polyline?.encodedPolyline;
  if (!route || typeof meters !== "number" || !encoded) {
    throw new Error("No drivable road route found between these points");
  }

  const seconds = Number(String(route.duration ?? "0s").replace(/s$/, ""));
  return {
    distanceKm: Math.max(0.5, +(meters / 1000).toFixed(1)),
    durationMin:
      Number.isFinite(seconds) && seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : 0,
    polyline: encoded,
  };
}
