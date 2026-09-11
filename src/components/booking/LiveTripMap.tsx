import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps, FARIDABAD_CENTER } from "@/lib/google-maps";
import { Navigation, Loader2 } from "lucide-react";

interface Props {
  pickupAddress: string;
  dropAddress: string;
  /** "accepted" → driver → pickup; "in_progress" → pickup → drop */
  phase: "accepted" | "in_progress";
  distanceKm: number;
}

type LatLng = { lat: number; lng: number };

/** Interactive map that renders the current active leg with a simulated driver marker. */
export function LiveTripMap({ pickupAddress, dropAddress, phase, distanceKm }: Props) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const routeRef = useRef<google.maps.Polyline | null>(null);
  const driverMarker = useRef<google.maps.Marker | null>(null);
  const pickupMarker = useRef<google.maps.Marker | null>(null);
  const dropMarker = useRef<google.maps.Marker | null>(null);
  const [pickup, setPickup] = useState<LatLng | null>(null);
  const [drop, setDrop] = useState<LatLng | null>(null);
  const [progress, setProgress] = useState(0);

  // Geocode both addresses once
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then(async (g) => {
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
      const [p, d] = await Promise.all([geo(pickupAddress), geo(dropAddress)]);
      if (!cancelled) {
        setPickup(p);
        setDrop(d);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pickupAddress, dropAddress]);

  const legFrom: LatLng | null = pickup && drop
    ? phase === "accepted"
      ? { lat: pickup.lat + 0.018, lng: pickup.lng - 0.014 }
      : pickup
    : null;
  const legTo: LatLng | null = phase === "accepted" ? pickup : drop;
  const legDistance = phase === "accepted" ? Math.max(0.4, distanceKm * 0.35) : Math.max(0.5, distanceKm);
  const eta = Math.max(2, Math.round(legDistance * (1 - progress) * 3));
  const remainingKm = (legDistance * (1 - progress)).toFixed(1);

  useEffect(() => {
    if (!mapRef.current || !pickup || !drop || !legFrom || !legTo) return;
    let cancelled = false;
    loadGoogleMaps().then((g) => {
      if (cancelled || !mapRef.current) return;
      mapInstance.current = new g.maps.Map(mapRef.current, {
        center: legTo,
        zoom: 14,
        disableDefaultUI: true,
        zoomControl: true,
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
        path: [legFrom, legTo],
        strokeColor: "#F97316",
        strokeOpacity: 0.9,
        strokeWeight: 4,
        map: mapInstance.current,
      });
      driverMarker.current = new g.maps.Marker({
        position: legFrom,
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
      const bounds = new g.maps.LatLngBounds();
      bounds.extend(pickup);
      bounds.extend(drop);
      bounds.extend(legFrom);
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
      mapInstance.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup, drop, phase]);

  useEffect(() => {
    setProgress(0);
    const id = setInterval(() => {
      setProgress((p) => Math.min(0.92, p + 0.04));
    }, 4000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (!driverMarker.current || !legFrom || !legTo) return;
    const lat = legFrom.lat + (legTo.lat - legFrom.lat) * progress;
    const lng = legFrom.lng + (legTo.lng - legFrom.lng) * progress;
    driverMarker.current.setPosition({ lat, lng });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  return (
    <div className="mt-3 overflow-hidden rounded-md border border-primary/30">
      <div className="flex items-center justify-between gap-2 bg-primary/10 px-3 py-2 text-primary">
        <div className="flex items-center gap-2">
          <Navigation className="h-4 w-4 animate-pulse" />
          <p className="text-sm font-semibold">
            {phase === "accepted"
              ? `Driver is ${remainingKm} km away · Arriving in ~${eta} min`
              : `On the way to drop · ${remainingKm} km · ~${eta} min`}
          </p>
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
        {phase === "accepted" ? "Driver → Pickup" : "Pickup → Drop"} · Live location updates automatically.
      </p>
    </div>
  );
}
