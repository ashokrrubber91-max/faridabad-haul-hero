import { loadGoogleMaps } from "@/lib/google-maps";

type PreviousLocation = {
  address: string;
  latitude: number | null;
  longitude: number | null;
};

export function hasExactCoordinates(latitude: number | null, longitude: number | null): boolean {
  return (
    latitude != null && longitude != null && Number.isFinite(latitude) && Number.isFinite(longitude)
  );
}

/** Older rides without stored coordinates must resolve their real address, never a default pin. */
export async function repeatBookingLocation({ address, latitude, longitude }: PreviousLocation) {
  if (latitude != null && longitude != null && hasExactCoordinates(latitude, longitude)) {
    return { address, lat: latitude, lng: longitude };
  }
  const g = await loadGoogleMaps();
  const result = await new g.maps.Geocoder().geocode({ address, region: "IN" });
  const point = result.results[0]?.geometry.location;
  if (!point)
    throw new Error("Could not locate the previous ride’s address. Please select it on the map.");
  return { address, lat: point.lat(), lng: point.lng() };
}
