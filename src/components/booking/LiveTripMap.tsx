import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { loadGoogleMaps, FARIDABAD_CENTER } from "@/lib/google-maps";
import { supabase } from "@/integrations/supabase/client";
import { computeRoadRoute } from "@/lib/routing.functions";
import { Navigation, Loader2, MapPin, AlertTriangle, LocateFixed, Route as RouteIcon } from "lucide-react";
import { TripSafetyActions } from "@/components/booking/TripSafetyActions";

interface Props {
  bookingId: string;
  driverId: string | null;
  pickupAddress: string;
  dropAddress: string;
  pickupLat?: number | null;
  pickupLng?: number | null;
  dropLat?: number | null;
  dropLng?: number | null;
  phase: "accepted" | "in_progress";
  distanceKm: number;
}

type LatLng = { lat: number; lng: number };
const FRESH_MS = 120_000;
const ANIMATION_MS = 900;

function bearingBetween(a: LatLng, b: LatLng): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function smoothAngle(from: number, to: number, t: number): number {
  const delta = ((to - from + 540) % 360) - 180;
  return from + delta * t;
}

function truckIcon(g: typeof google, bearing: number): google.maps.Icon {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
    <g transform="rotate(${bearing.toFixed(1)} 24 24)">
      <rect x="7" y="12" width="24" height="20" rx="3" fill="#F97316" stroke="#fff" stroke-width="3"/>
      <path d="M31 18h7l5 6v8H31z" fill="#F97316" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
      <circle cx="15" cy="35" r="4" fill="#1E293B" stroke="#fff" stroke-width="2"/>
      <circle cx="35" cy="35" r="4" fill="#1E293B" stroke="#fff" stroke-width="2"/>
      <path d="M34 21h4l3 4h-7z" fill="#fff" opacity=".9"/>
    </g>
  </svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new g.maps.Size(48, 48),
    anchor: new g.maps.Point(24, 24),
  };
}

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
  const animationFrameRef = useRef<number | null>(null);
  const animatedPositionRef = useRef<LatLng | null>(null);
  const bearingRef = useRef(0);
  const autoCenterRef = useRef(true);

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
  const [mapError, setMapError] = useState(false);
  const [autoCenter, setAutoCenter] = useState(true);

  useEffect(() => {
    autoCenterRef.current = autoCenter;
  }, [autoCenter]);

  useEffect(() => {
    if (exactPickup && exactDrop) {
      setPickup(exactPickup);
      setDrop(exactDrop);
      return;
    }
    let cancelled = false;
    void loadGoogleMaps()
      .then(async (g) => {
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
      })
      .catch(() => {
        if (!cancelled) {
          setMapError(true);
          setPickup(exactPickup ?? FARIDABAD_CENTER);
          setDrop(exactDrop ?? FARIDABAD_CENTER);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pickupAddress, dropAddress, pickupLat, pickupLng, dropLat, dropLng]);

  const location = useQuery({
    queryKey: ["driver-location", driverId, bookingId],
    enabled: !!driverId,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("driver_locations")
        .select("latitude, longitude, updated_at, speed_mps, heading_deg")
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
        { event: "*", schema: "public", table: "driver_locations", filter: `driver_id=eq.${driverId}` },
        () => void location.refetch(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [driverId]);

  const lastFix = useMemo<{ pos: LatLng; ageMs: number; heading: number | null } | null>(() => {
    const row = location.data;
    if (!row) return null;
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
      return null;
    const ageMs = Date.now() - new Date(row.updated_at).getTime();
    const heading = row.heading_deg == null ? null : Number(row.heading_deg);
    return {
      pos: { lat, lng },
      ageMs: Number.isFinite(ageMs) ? Math.max(0, ageMs) : Infinity,
      heading: Number.isFinite(heading) ? heading : null,
    };
  }, [location.data]);

  const driverPos = lastFix && lastFix.ageMs <= FRESH_MS ? lastFix.pos : null;
  const staleMinutes =
    lastFix && lastFix.ageMs > FRESH_MS ? Math.round(lastFix.ageMs / 60000) : null;

  const target = phase === "accepted" ? pickup : drop;
  const origin = driverPos ?? pickup;
  const roundedKey = (p: LatLng | null) => (p ? `${p.lat.toFixed(4)},${p.lng.toFixed(4)}` : "none");

  const road = useQuery({
    queryKey: ["road-route", roundedKey(origin), roundedKey(target)],
    enabled: !!origin && !!target,
    staleTime: 20_000,
    refetchInterval: 15_000,
    retry: 1,
    queryFn: () => computeRoadRoute({ data: { points: [origin!, target!] } }),
  });

  const remainingKm = driverPos && road.data ? road.data.distanceKm : null;
  const eta = driverPos && road.data?.durationMin ? road.data.durationMin : null;

  useEffect(() => {
    if (!mapRef.current || !pickup || !drop) return;
    let cancelled = false;
    void loadGoogleMaps()
      .then((g) => {
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
      })
      .catch(() => {
        if (!cancelled) setMapError(true);
      });

    return () => {
      cancelled = true;
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      routeRef.current?.setMap(null);
      driverMarker.current?.setMap(null);
      pickupMarker.current?.setMap(null);
      dropMarker.current?.setMap(null);
      routeRef.current = null;
      driverMarker.current = null;
      mapInstance.current = null;
      animatedPositionRef.current = null;
    };
  }, [pickup, drop]);

  useEffect(() => {
    const encoded = road.data?.polyline;
    if (!encoded) {
      routeRef.current?.setMap(null);
      routeRef.current = null;
      return;
    }
    void loadGoogleMaps()
      .then((g) => {
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
        if (!autoCenterRef.current) return;
        const bounds = new g.maps.LatLngBounds();
        path.forEach((pt) => bounds.extend(pt));
        if (!driverPos) {
          mapInstance.current.fitBounds(bounds, 60);
        }
      })
      .catch(() => setMapError(true));
  }, [road.data?.polyline]);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    if (!driverPos) {
      driverMarker.current?.setMap(null);
      driverMarker.current = null;
      animatedPositionRef.current = null;
      return;
    }

    void loadGoogleMaps()
      .then((g) => {
        if (!mapInstance.current) return;

        const previous = animatedPositionRef.current;
        const targetBearing =
          lastFix?.heading != null
            ? lastFix.heading
            : previous && (previous.lat !== driverPos.lat || previous.lng !== driverPos.lng)
              ? bearingBetween(previous, driverPos)
              : bearingRef.current;

        if (!driverMarker.current) {
          bearingRef.current = targetBearing;
          driverMarker.current = new g.maps.Marker({
            position: driverPos,
            map: mapInstance.current,
            icon: truckIcon(g, targetBearing),
            title: "MiniPort driver",
            zIndex: 20,
          });
          animatedPositionRef.current = driverPos;
          if (autoCenterRef.current) mapInstance.current.panTo(driverPos);
          return;
        }

        const start = animatedPositionRef.current ?? driverMarker.current.getPosition()?.toJSON() ?? driverPos;
        const startBearing = bearingRef.current;
        const startedAt = performance.now();
        if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);

        const tick = (now: number) => {
          const progress = Math.min(1, (now - startedAt) / ANIMATION_MS);
          const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
          const next = {
            lat: start.lat + (driverPos.lat - start.lat) * eased,
            lng: start.lng + (driverPos.lng - start.lng) * eased,
          };
          const nextBearing = smoothAngle(startBearing, targetBearing, eased);
          driverMarker.current?.setPosition(next);
          driverMarker.current?.setIcon(truckIcon(g, nextBearing));
          if (autoCenterRef.current) mapInstance.current?.panTo(next);
          if (progress < 1) {
            animationFrameRef.current = requestAnimationFrame(tick);
          } else {
            bearingRef.current = targetBearing;
            animatedPositionRef.current = driverPos;
            animationFrameRef.current = null;
          }
        };
        animationFrameRef.current = requestAnimationFrame(tick);
      })
      .catch(() => setMapError(true));
  }, [driverPos, lastFix?.heading]);

  const recenterOrOverview = () => {
    const map = mapInstance.current;
    if (!map) return;
    if (autoCenter) {
      setAutoCenter(false);
      const bounds = new google.maps.LatLngBounds();
      if (pickup) bounds.extend(pickup);
      if (drop) bounds.extend(drop);
      if (driverPos) bounds.extend(driverPos);
      map.fitBounds(bounds, 60);
    } else {
      setAutoCenter(true);
      if (driverPos) map.panTo(driverPos);
    }
  };

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
        <div className="flex items-center gap-2 min-w-0">
          {routeFailed ? (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          ) : driverPos ? (
            <Navigation className="h-4 w-4 animate-pulse shrink-0" />
          ) : (
            <MapPin className="h-4 w-4 shrink-0" />
          )}
          <p className="truncate text-sm font-semibold">{headline}</p>
        </div>
        <button
          type="button"
          onClick={recenterOrOverview}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] font-semibold text-secondary shadow-sm"
          aria-label={autoCenter ? "Overview route" : "Recenter on driver"}
        >
          {autoCenter ? <RouteIcon className="h-3.5 w-3.5" /> : <LocateFixed className="h-3.5 w-3.5" />}
          {autoCenter ? "Overview Route" : "Recenter on Driver"}
        </button>
      </div>
      <div className="relative h-[240px] w-full bg-muted">
        <div ref={mapRef} className="absolute inset-0 h-full w-full" />
        {mapError ? (
          <div className="absolute inset-0 grid place-items-center px-4 text-center">
            <p className="text-xs text-muted-foreground">
              The map cannot be shown right now. Your pickup, drop and distance are unchanged, and
              the driver&rsquo;s progress still updates in the trip details above.
            </p>
          </div>
        ) : (
          (!pickup || !drop) && (
            <div className="absolute inset-0 grid place-items-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          )
        )}
      </div>
      <p className="border-t bg-background px-3 py-1.5 text-[11px] text-muted-foreground">
        {routeFailed
          ? "Road route could not be loaded, so no route line is shown. Pickup and drop pins are exact."
          : driverPos
            ? "Live driver location, bearing and road ETA · updates automatically"
            : staleMinutes !== null
              ? "The last position shown was too old to be trusted, so the driver pin is hidden until a new GPS update arrives."
              : "Driver location appears once their app shares GPS (location permission needed)."}
      </p>
      <TripSafetyActions bookingId={bookingId} pickupAddress={pickupAddress} dropAddress={dropAddress} phase={phase} eta={eta} />
    </div>
  );
}
