import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { loadGoogleMaps, FARIDABAD_CENTER } from "@/lib/google-maps";
import { supabase } from "@/integrations/supabase/client";
import { computeRoadRoute } from "@/lib/routing.functions";
import { Navigation, Loader2, MapPin, AlertTriangle } from "lucide-react";

interface Props {
  bookingId: string;
  driverId: string | null;
  pickupAddress: string;
  dropAddress: string;
  pickupLat?: number | null;
  pickupLng?: number | null;
  dropLat?: number | null;
  dropLng?: number | null;
  /** "accepted" → driver → pickup; "in_progress" → pickup → drop */
  phase: "accepted" | "in_progress";
  distanceKm: number;
}

type LatLng = { lat: number; lng: number };

/** A GPS fix older than this is treated as unavailable rather than shown as live. */
const FRESH_MS = 120_000;

/**
 * Live trip map driven by the driver's real GPS reports and authoritative road
 * routing from the Routes API. When GPS or routing is unavailable it says so
 * instead of drawing an invented straight line or estimated distance.
 */
export function LiveTripMap({
  bookingId,
  driverId,
  pickupAddress,
  dropAddress,
  pickupLat,
  pickupLng,
  dropLat,
  dropLng,
  phase,
  distanceKm,
}: Props) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const routeRef = useRef<google.maps.Polyline | null>(null);
  const driverMarker = useRef<google.maps.Marker | null>(null);
  const pickupMarker = useRef<google.maps.Marker | null>(null);
  const dropMarker = useRef<google.maps.Marker | null>(null);

  const exactPickup: LatLng | null =
    typeof pickupLat === "number" && typeof pickupLng === "number"
      ? { lat: pickupLat, lng: pickupLng }
      : null;
  const exactDrop: LatLng | null =
    typeof dropLat === "number" && typeof dropLng === "number"
      ? { lat: dropLat, lng: dropLng }
      : null;

  const [pickup, setPickup] = useState<LatLng | null>(exactPickup);
  const [drop, setDrop] = useState<LatLng | null>(exactDrop);

  // Only geocode when the customer's exact pin was not stored with the booking.
  useEffect(() => {
    if (exactPickup && exactDrop) {
      setPickup(exactPickup);
      setDrop(exactDrop);
      return;
    }
    let cancelled = false;
    void loadGoogleMaps().then(async (g) => {
      const geocoder = new g.maps.Geocoder();
      const geo = async (addr: string): Promise<LatLng> => {
        try {
          const res = await geocoder.geocode({ address: addr, region: "IN" });
          const loc = res.results[0]?.geometry.location;
          return loc ? { lat: loc.lat(), lng: loc.lng() } : FARIDABAD_CENTER;
        } catch {
          return FARIDABAD_CENTER;
        }
      };
      const [p, d] = await Promise.all([
        exactPickup ? Promise.resolve(exactPickup) : geo(pickupAddress),
        exactDrop ? Promise.resolve(exactDrop) : geo(dropAddress),
      ]);
      if (!cancelled) {
        setPickup(p);
        setDrop(d);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupAddress, dropAddress, pickupLat, pickupLng, dropLat, dropLng]);

  // Real driver position. Polled, plus live database updates.
  const location = useQuery({
    queryKey: ["driver-location", driverId, bookingId],
    enabled: !!driverId,
    // Live updates arrive over the realtime channel below; this slower poll is
    // only a safety net for a dropped socket, so it must not duplicate it.
    refetchInterval: 25_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("driver_locations")
        .select("latitude, longitude, updated_at, speed_mps")
        .eq("driver_id", driverId!)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });

  useEffect(() => {
    if (!driverId) return;
    const ch = supabase
      .channel(`driver-loc-${driverId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "driver_locations",
          filter: `driver_id=eq.${driverId}`,
        },
        () => void location.refetch(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverId]);

  /** Last real GPS report, with its age. Nothing here is interpolated. */
  const lastFix = useMemo<{ pos: LatLng; ageMs: number } | null>(() => {
    const row = location.data;
    if (!row) return null;
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    const ageMs = Date.now() - new Date(row.updated_at).getTime();
    if (!Number.isFinite(ageMs)) return null;
    return { pos: { lat, lng }, ageMs: Math.max(0, ageMs) };
  }, [location.data]);

  // Only a fresh fix counts as live tracking; a stale one is reported as stale
  // rather than drawn as if the driver were still there.
  const driverPos = lastFix && lastFix.ageMs <= FRESH_MS ? lastFix.pos : null;
  const staleMinutes = lastFix && lastFix.ageMs > FRESH_MS ? Math.round(lastFix.ageMs / 60000) : null;

  const target = phase === "accepted" ? pickup : drop;
  const origin = driverPos ?? pickup;

  // Authoritative road route (geometry + distance + ETA) from the Routes API.
  const roundedKey = (p: LatLng | null) => (p ? `${p.lat.toFixed(3)},${p.lng.toFixed(3)}` : "none");
  const road = useQuery({
    queryKey: ["road-route", roundedKey(origin), roundedKey(target)],
    enabled: !!origin && !!target,
    staleTime: 30_000,
    retry: 1,
    queryFn: () => computeRoadRoute({ data: { points: [origin!, target!] } }),
  });

  const remainingKm = driverPos && road.data ? road.data.distanceKm : null;
  const eta = driverPos && road.data?.durationMin ? road.data.durationMin : null;

  // Draw the map once both ends are known.
  useEffect(() => {
    if (!mapRef.current || !pickup || !drop) return;
    let cancelled = false;
    void loadGoogleMaps().then((g) => {
      if (cancelled || !mapRef.current) return;
      mapInstance.current = new g.maps.Map(mapRef.current, {
        center: target ?? pickup,
        zoom: 14,
        disableDefaultUI: true,
        zoomControl: true,
        clickableIcons: false,
        gestureHandling: "greedy",
      });
      pickupMarker.current = new g.maps.Marker({
        position: pickup,
        map: mapInstance.current,
        label: { text: "P", color: "#fff", fontSize: "11px", fontWeight: "700" },
      });
      dropMarker.current = new g.maps.Marker({
        position: drop,
        map: mapInstance.current,
        label: { text: "D", color: "#fff", fontSize: "11px", fontWeight: "700" },
      });
      const bounds = new g.maps.LatLngBounds();
      bounds.extend(pickup);
      bounds.extend(drop);
      mapInstance.current.fitBounds(bounds, 60);
      setTimeout(() => {
        if (mapInstance.current) g.maps.event.trigger(mapInstance.current, "resize");
      }, 250);
    });
    return () => {
      cancelled = true;
      routeRef.current?.setMap(null);
      driverMarker.current?.setMap(null);
      pickupMarker.current?.setMap(null);
      dropMarker.current?.setMap(null);
      routeRef.current = null;
      driverMarker.current = null;
      mapInstance.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup, drop]);

  // Draw only real road geometry returned by the Routes API.
  useEffect(() => {
    const encoded = road.data?.polyline;
    if (!encoded) {
      routeRef.current?.setMap(null);
      routeRef.current = null;
      return;
    }
    void loadGoogleMaps().then((g) => {
      if (!mapInstance.current) return;
      const path = g.maps.geometry.encoding.decodePath(encoded);
      routeRef.current?.setMap(null);
      routeRef.current = new g.maps.Polyline({
        path,
        strokeColor: "#F97316",
        strokeOpacity: 0.85,
        strokeWeight: 5,
        map: mapInstance.current,
      });
      const bounds = new g.maps.LatLngBounds();
      path.forEach((pt) => bounds.extend(pt));
      mapInstance.current.fitBounds(bounds, 60);
    });
  }, [road.data?.polyline]);

  // Move the driver marker to the real reported position only.
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    if (!driverPos) {
      driverMarker.current?.setMap(null);
      driverMarker.current = null;
      return;
    }
    void loadGoogleMaps().then((g) => {
      if (!mapInstance.current) return;
      if (!driverMarker.current) {
        driverMarker.current = new g.maps.Marker({
          position: driverPos,
          map: mapInstance.current,
          icon: {
            path: g.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: "#F97316",
            fillOpacity: 1,
            strokeColor: "#fff",
            strokeWeight: 3,
          },
        });
      } else {
        driverMarker.current.setPosition(driverPos);
      }
    });
  }, [driverPos]);

  const routeFailed = road.isError;
  const headline = driverPos
    ? remainingKm !== null
      ? phase === "accepted"
        ? `Driver is ${remainingKm.toFixed(1)} km away by road${eta ? ` · Arriving in ~${eta} min` : ""}`
        : `On the way to drop · ${remainingKm.toFixed(1)} km by road${eta ? ` · ~${eta} min` : ""}`
      : routeFailed
        ? "Live location received · road distance unavailable right now"
        : "Calculating road route…"
    : staleMinutes !== null
      ? `Driver's location last updated ${staleMinutes < 1 ? "just under a minute" : `${staleMinutes} min`} ago · waiting for a fresh GPS update`
      : phase === "accepted"
        ? "Waiting for the driver's live location…"
        : `Trip in progress · ${Math.max(0.5, distanceKm).toFixed(1)} km booked route`;

  return (
    <div className="mt-3 overflow-hidden rounded-md border border-primary/30">
      <div className="flex items-center justify-between gap-2 bg-primary/10 px-3 py-2 text-primary">
        <div className="flex items-center gap-2">
          {routeFailed ? (
            <AlertTriangle className="h-4 w-4" />
          ) : driverPos ? (
            <Navigation className="h-4 w-4 animate-pulse" />
          ) : (
            <MapPin className="h-4 w-4" />
          )}
          <p className="text-sm font-semibold">{headline}</p>
        </div>
      </div>
      <div className="relative h-[240px] w-full bg-muted">
        <div ref={mapRef} className="absolute inset-0 h-full w-full" />
        {(!pickup || !drop) && (
          <div className="absolute inset-0 grid place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        )}
      </div>
      <p className="border-t bg-background px-3 py-1.5 text-[11px] text-muted-foreground">
        {routeFailed
          ? "Road route could not be loaded, so no route line is shown. Pickup and drop pins are exact."
          : driverPos
            ? "Live driver location and road route · updates automatically"
            : staleMinutes !== null
              ? "The last position shown was too old to be trusted, so the driver pin is hidden until a new GPS update arrives."
              : "Driver location appears once their app shares GPS (location permission needed)."}
      </p>
    </div>
  );
}
