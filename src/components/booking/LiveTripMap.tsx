import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { loadGoogleMaps, FARIDABAD_CENTER } from "@/lib/google-maps";
import { supabase } from "@/integrations/supabase/client";
import { haversineKm } from "@/lib/booking";
import { Navigation, Loader2, MapPin } from "lucide-react";

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
const AVG_SPEED_KMH = 22;

/**
 * Live trip map driven by the driver's real GPS reports. When no recent fix is
 * available it says so instead of showing an invented position.
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
    typeof pickupLat === "number" && typeof pickupLng === "number" ? { lat: pickupLat, lng: pickupLng } : null;
  const exactDrop: LatLng | null =
    typeof dropLat === "number" && typeof dropLng === "number" ? { lat: dropLat, lng: dropLng } : null;

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
    refetchInterval: 10_000,
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
        { event: "*", schema: "public", table: "driver_locations", filter: `driver_id=eq.${driverId}` },
        () => void location.refetch(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverId]);

  const driverPos = useMemo<LatLng | null>(() => {
    const row = location.data;
    if (!row) return null;
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    const age = Date.now() - new Date(row.updated_at).getTime();
    if (!Number.isFinite(age) || age > FRESH_MS) return null;
    return { lat, lng };
  }, [location.data]);

  const target = phase === "accepted" ? pickup : drop;
  const remainingKm = driverPos && target ? haversineKm(driverPos, target) * 1.3 : null;
  const eta = remainingKm !== null ? Math.max(1, Math.round((remainingKm / AVG_SPEED_KMH) * 60)) : null;

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
      routeRef.current = new g.maps.Polyline({
        path: [pickup, drop],
        strokeColor: "#F97316",
        strokeOpacity: 0.75,
        strokeWeight: 4,
        map: mapInstance.current,
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
      driverMarker.current = null;
      mapInstance.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup, drop]);

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

  const headline = driverPos
    ? phase === "accepted"
      ? `Driver is ${remainingKm!.toFixed(1)} km away · Arriving in ~${eta} min`
      : `On the way to drop · ${remainingKm!.toFixed(1)} km · ~${eta} min`
    : phase === "accepted"
      ? "Waiting for the driver's live location…"
      : `Trip in progress · ${Math.max(0.5, distanceKm).toFixed(1)} km route`;

  return (
    <div className="mt-3 overflow-hidden rounded-md border border-primary/30">
      <div className="flex items-center justify-between gap-2 bg-primary/10 px-3 py-2 text-primary">
        <div className="flex items-center gap-2">
          {driverPos ? <Navigation className="h-4 w-4 animate-pulse" /> : <MapPin className="h-4 w-4" />}
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
        {driverPos
          ? "Live driver location · updates automatically"
          : "Driver location appears once their app shares GPS (location permission needed)."}
      </p>
    </div>
  );
}
