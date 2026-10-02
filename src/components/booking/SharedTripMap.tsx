import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/google-maps";
import { LocateFixed, Route as RouteIcon } from "lucide-react";

type LatLng = { lat: number; lng: number };
type LiveRoute = { distanceKm: number; durationMin: number; polyline: string };

function bearingBetween(a: LatLng, b: LatLng): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
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

export function SharedTripMap({
  pickup,
  drop,
  driver,
  route,
}: {
  pickup: LatLng | null;
  drop: LatLng | null;
  driver: LatLng | null;
  route?: LiveRoute | null;
}) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const map = useRef<google.maps.Map | null>(null);
  const marker = useRef<google.maps.Marker | null>(null);
  const routeLine = useRef<google.maps.Polyline | null>(null);
  const previous = useRef<LatLng | null>(null);
  const frame = useRef<number | null>(null);
  const bearing = useRef(0);
  const autoCenterRef = useRef(true);
  const [autoCenter, setAutoCenter] = useState(true);

  useEffect(() => {
    autoCenterRef.current = autoCenter;
  }, [autoCenter]);

  useEffect(() => {
    if (!mapRef.current || !pickup || !drop) return;
    let cancelled = false;
    void loadGoogleMaps().then((g) => {
      if (cancelled || !mapRef.current) return;
      map.current = new g.maps.Map(mapRef.current, {
        center: driver ?? pickup,
        zoom: 14,
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: "greedy",
      });
      new g.maps.Marker({
        map: map.current,
        position: pickup,
        label: { text: "P", color: "#fff", fontSize: "11px", fontWeight: "700" },
      });
      new g.maps.Marker({
        map: map.current,
        position: drop,
        label: { text: "D", color: "#fff", fontSize: "11px", fontWeight: "700" },
      });
      const bounds = new g.maps.LatLngBounds();
      bounds.extend(pickup);
      bounds.extend(drop);
      if (driver) bounds.extend(driver);
      map.current.fitBounds(bounds, 50);
    });
    return () => {
      cancelled = true;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      routeLine.current?.setMap(null);
      marker.current?.setMap(null);
      map.current = null;
      previous.current = null;
    };
  }, [pickup?.lat, pickup?.lng, drop?.lat, drop?.lng]);

  useEffect(() => {
    if (!route?.polyline || !map.current) return;
    void loadGoogleMaps().then((g) => {
      if (!map.current) return;
      const path = g.maps.geometry.encoding.decodePath(route.polyline);
      routeLine.current?.setMap(null);
      routeLine.current = new g.maps.Polyline({
        path,
        strokeColor: "#F97316",
        strokeOpacity: 0.85,
        strokeWeight: 5,
        map: map.current,
      });
    });
  }, [route?.polyline]);

  useEffect(() => {
    if (!driver || !map.current) {
      marker.current?.setMap(null);
      marker.current = null;
      previous.current = null;
      return;
    }
    void loadGoogleMaps().then((g) => {
      if (!map.current) return;
      const start = previous.current ?? driver;
      const targetBearing =
        previous.current &&
        (previous.current.lat !== driver.lat || previous.current.lng !== driver.lng)
          ? bearingBetween(previous.current, driver)
          : bearing.current;

      if (!marker.current) {
        bearing.current = targetBearing;
        marker.current = new g.maps.Marker({
          map: map.current,
          position: start,
          icon: truckIcon(g, targetBearing),
          title: "Live MiniPort driver",
          zIndex: 20,
        });
      }

      if (frame.current !== null) cancelAnimationFrame(frame.current);
      const started = performance.now();
      const startBearing = bearing.current;

      const tick = (now: number) => {
        const t = Math.min(1, (now - started) / 900);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const next = {
          lat: start.lat + (driver.lat - start.lat) * eased,
          lng: start.lng + (driver.lng - start.lng) * eased,
        };
        const nextBearing = smoothAngle(startBearing, targetBearing, eased);
        marker.current?.setPosition(next);
        marker.current?.setIcon(truckIcon(g, nextBearing));
        if (autoCenterRef.current) map.current?.panTo(next);
        if (t < 1) {
          frame.current = requestAnimationFrame(tick);
        } else {
          previous.current = driver;
          bearing.current = targetBearing;
          frame.current = null;
        }
      };
      frame.current = requestAnimationFrame(tick);
    });
  }, [driver?.lat, driver?.lng]);

  const toggleCenter = () => {
    const next = !autoCenter;
    setAutoCenter(next);
    if (!next && map.current) {
      const bounds = new google.maps.LatLngBounds();
      if (pickup) bounds.extend(pickup);
      if (drop) bounds.extend(drop);
      if (driver) bounds.extend(driver);
      map.current.fitBounds(bounds, 50);
    } else if (next && driver) {
      map.current?.panTo(driver);
    }
  };

  return (
    <div className="relative h-[240px] w-full rounded-md">
      <div ref={mapRef} className="absolute inset-0 h-full w-full rounded-md" aria-label="Live trip map" />
      <button
        type="button"
        onClick={toggleCenter}
        className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-md border bg-background/95 px-2 py-1 text-[11px] font-semibold text-secondary shadow-sm backdrop-blur"
        aria-label={autoCenter ? "Overview route" : "Recenter on driver"}
      >
        {autoCenter ? <RouteIcon className="h-3.5 w-3.5" /> : <LocateFixed className="h-3.5 w-3.5" />}
        {autoCenter ? "Overview Route" : "Recenter on Driver"}
      </button>
    </div>
  );
}
