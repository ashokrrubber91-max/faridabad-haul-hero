import { useEffect, useRef } from "react";
import { loadGoogleMaps } from "@/lib/google-maps";

type LatLng = { lat: number; lng: number };
type LiveRoute = { distanceKm: number; durationMin: number; polyline: string };

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
      return;
    }
    void loadGoogleMaps().then((g) => {
      if (!map.current) return;
      const start = previous.current ?? driver;
      if (!marker.current) {
        marker.current = new g.maps.Marker({
          map: map.current,
          position: start,
          icon: {
            path: g.maps.SymbolPath.FORWARD_CLOSED_ARROW,
            scale: 6,
            fillColor: "#F97316",
            fillOpacity: 1,
            strokeColor: "#fff",
            strokeWeight: 2,
          },
          title: "Live MiniPort driver",
          zIndex: 20,
        });
      }
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      const started = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - started) / 900);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const next = {
          lat: start.lat + (driver.lat - start.lat) * eased,
          lng: start.lng + (driver.lng - start.lng) * eased,
        };
        marker.current?.setPosition(next);
        map.current?.panTo(next);
        if (t < 1) frame.current = requestAnimationFrame(tick);
        else {
          previous.current = driver;
          frame.current = null;
        }
      };
      frame.current = requestAnimationFrame(tick);
    });
  }, [driver?.lat, driver?.lng]);

  return <div ref={mapRef} className="h-[240px] w-full rounded-md" aria-label="Live trip map" />;
}
