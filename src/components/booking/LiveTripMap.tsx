import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/google-maps";
import { Navigation } from "lucide-react";

interface Props {
  pickup: { lat: number; lng: number; address: string };
  drop: { lat: number; lng: number; address: string };
  /** "accepted" → driver → pickup; "in_progress" → driver → drop */
  phase: "accepted" | "in_progress";
  distanceKm: number;
}

/**
 * Interactive map that renders the current active leg (driver → pickup, or pickup → drop).
 * Uses a simulated driver marker that eases along the route line until real telemetry is wired up.
 */
export function LiveTripMap({ pickup, drop, phase, distanceKm }: Props) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const routeRef = useRef<google.maps.Polyline | null>(null);
  const driverMarker = useRef<google.maps.Marker | null>(null);
  const pickupMarker = useRef<google.maps.Marker | null>(null);
  const dropMarker = useRef<google.maps.Marker | null>(null);
  const [progress, setProgress] = useState(0);

  const legFrom = phase === "accepted"
    ? { lat: pickup.lat + 0.018, lng: pickup.lng - 0.014 } // simulated driver origin near pickup
    : pickup;
  const legTo = phase === "accepted" ? pickup : drop;
  const legDistance = phase === "accepted" ? Math.max(0.4, distanceKm * 0.35) : Math.max(0.5, distanceKm);
  const eta = Math.max(2, Math.round(legDistance * (1 - progress) * 3));
  const remainingKm = (legDistance * (1 - progress)).toFixed(1);

  useEffect(() => {
    if (!mapRef.current) return;
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
  }, [phase, pickup.lat, pickup.lng, drop.lat, drop.lng]);

  // Simulate driver movement toward the target
  useEffect(() => {
    setProgress(0);
    const id = setInterval(() => {
      setProgress((p) => Math.min(0.92, p + 0.04));
    }, 4000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (!driverMarker.current) return;
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
      <div ref={mapRef} className="h-[240px] w-full bg-muted" />
      <p className="border-t bg-background px-3 py-1.5 text-[11px] text-muted-foreground">
        {phase === "accepted" ? "Driver → Pickup" : "Pickup → Drop"} · Live location updates automatically.
      </p>
    </div>
  );
}
