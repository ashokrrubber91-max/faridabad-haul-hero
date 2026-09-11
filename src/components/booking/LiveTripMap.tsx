import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps, FARIDABAD_CENTER } from "@/lib/google-maps";
import { supabase } from "@/integrations/supabase/client";
import { Navigation, Loader2, WifiOff } from "lucide-react";

interface Props {
  pickupAddress: string;
  dropAddress: string;
  phase: "accepted" | "in_progress";
  distanceKm: number;
}

type LatLng = { lat: number; lng: number };
type DriverLocation = LatLng & { updated_at: string; accuracy_m: number | null };

/** Customer live-trip map: real driver GPS + Google road route/ETA. Never simulates movement. */
export function LiveTripMap({ pickupAddress, dropAddress, phase, distanceKm }: Props) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const rendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const driverMarker = useRef<google.maps.Marker | null>(null);
  const pickupMarker = useRef<google.maps.Marker | null>(null);
  const dropMarker = useRef<google.maps.Marker | null>(null);
  const [pickup, setPickup] = useState<LatLng | null>(null);
  const [drop, setDrop] = useState<LatLng | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [driverLocation, setDriverLocation] = useState<DriverLocation | null>(null);
  const [routeKm, setRouteKm] = useState<number | null>(null);
  const [etaMin, setEtaMin] = useState<number | null>(null);
  const [gpsAge, setGpsAge] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(async ({ data: auth }) => {
      if (!auth.user || cancelled) return;
      const { data } = await supabase
        .from("bookings")
        .select("driver_id")
        .eq("customer_id", auth.user.id)
        .eq("pickup_address", pickupAddress)
        .eq("drop_address", dropAddress)
        .in("status", ["accepted", "in_progress"])
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setDriverId(data?.driver_id ?? null);
    });
    return () => { cancelled = true; };
  }, [pickupAddress, dropAddress, phase]);

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
      if (!cancelled) { setPickup(p); setDrop(d); }
    });
    return () => { cancelled = true; };
  }, [pickupAddress, dropAddress]);

  useEffect(() => {
    if (!driverId) { setDriverLocation(null); return; }
    let cancelled = false;
    supabase.from("driver_locations").select("latitude,longitude,updated_at,accuracy_m").eq("driver_id", driverId).maybeSingle().then(({ data }) => {
      if (!cancelled && data) setDriverLocation({ lat: data.latitude, lng: data.longitude, updated_at: data.updated_at, accuracy_m: data.accuracy_m });
    });
    const channel = supabase.channel(`driver-location-${driverId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_locations", filter: `driver_id=eq.${driverId}` }, (payload) => {
        const row = payload.new as { latitude?: number; longitude?: number; updated_at?: string; accuracy_m?: number | null };
        if (typeof row.latitude === "number" && typeof row.longitude === "number") {
          setDriverLocation({ lat: row.latitude, lng: row.longitude, updated_at: row.updated_at ?? new Date().toISOString(), accuracy_m: row.accuracy_m ?? null });
        }
      }).subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [driverId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (driverLocation) setGpsAge(Math.max(0, Math.round((Date.now() - new Date(driverLocation.updated_at).getTime()) / 1000)));
    }, 5000);
    if (driverLocation) setGpsAge(Math.max(0, Math.round((Date.now() - new Date(driverLocation.updated_at).getTime()) / 1000)));
    return () => window.clearInterval(timer);
  }, [driverLocation]);

  useEffect(() => {
    if (!mapRef.current || !pickup || !drop) return;
    let cancelled = false;
    loadGoogleMaps().then((g) => {
      if (cancelled || !mapRef.current) return;
      mapInstance.current = new g.maps.Map(mapRef.current, { center: pickup, zoom: 14, disableDefaultUI: true, zoomControl: true, gestureHandling: "greedy" });
      pickupMarker.current = new g.maps.Marker({ position: pickup, map: mapInstance.current, label: { text: "P", color: "#fff", fontSize: "11px", fontWeight: "700" } });
      dropMarker.current = new g.maps.Marker({ position: drop, map: mapInstance.current, label: { text: "D", color: "#fff", fontSize: "11px", fontWeight: "700" } });
      rendererRef.current = new g.maps.DirectionsRenderer({ map: mapInstance.current, suppressMarkers: true, polylineOptions: { strokeOpacity: 0.9, strokeWeight: 5 } });
    });
    return () => {
      cancelled = true;
      rendererRef.current?.setMap(null);
      driverMarker.current?.setMap(null);
      pickupMarker.current?.setMap(null);
      dropMarker.current?.setMap(null);
      mapInstance.current = null;
    };
  }, [pickup, drop]);

  useEffect(() => {
    if (!mapInstance.current || !pickup || !drop) return;
    loadGoogleMaps().then((g) => {
      const service = new g.maps.DirectionsService();
      const origin = phase === "accepted" && driverLocation ? driverLocation : phase === "in_progress" && driverLocation ? driverLocation : pickup;
      const destination = phase === "accepted" ? pickup : drop;
      service.route({ origin, destination, travelMode: g.maps.TravelMode.DRIVING, provideRouteAlternatives: false }, (result, status) => {
        if (status !== "OK" || !result?.routes[0]) return;
        rendererRef.current?.setDirections(result);
        const leg = result.routes[0].legs[0];
        if (leg?.distance?.value != null) setRouteKm(leg.distance.value / 1000);
        if (leg?.duration?.value != null) setEtaMin(Math.max(1, Math.round(leg.duration.value / 60)));
        const bounds = result.routes[0].bounds;
        if (bounds && mapInstance.current) mapInstance.current.fitBounds(bounds, 60);
      });
    });
  }, [pickup, drop, phase, driverLocation]);

  useEffect(() => {
    if (!mapInstance.current || !driverLocation) return;
    loadGoogleMaps().then((g) => {
      if (!driverMarker.current) {
        driverMarker.current = new g.maps.Marker({ position: driverLocation, map: mapInstance.current, title: "Driver", icon: { path: g.maps.SymbolPath.CIRCLE, scale: 8, fillOpacity: 1, strokeColor: "#fff", strokeWeight: 3 } });
      } else {
        driverMarker.current.setPosition(driverLocation);
      }
    });
  }, [driverLocation]);

  const displayKm = routeKm ?? distanceKm;
  const displayEta = etaMin;
  const gpsLive = driverLocation && (gpsAge ?? 999999) <= 30;

  return (
    <div className="mt-3 overflow-hidden rounded-md border border-primary/30">
      <div className="flex items-center justify-between gap-2 bg-primary/10 px-3 py-2 text-primary">
        <div className="flex items-center gap-2">
          {gpsLive ? <Navigation className="h-4 w-4 animate-pulse" /> : <WifiOff className="h-4 w-4" />}
          <p className="text-sm font-semibold">
            {phase === "accepted"
              ? `Driver → pickup · ${displayKm.toFixed(1)} km${displayEta ? ` · ~${displayEta} min` : ""}`
              : `Driver → drop · ${displayKm.toFixed(1)} km${displayEta ? ` · ~${displayEta} min` : ""}`}
          </p>
        </div>
        <span className="text-[10px] font-medium">{gpsLive ? `GPS live · ${gpsAge}s` : "Waiting for GPS"}</span>
      </div>
      <div className="relative h-[240px] w-full bg-muted">
        <div ref={mapRef} className="absolute inset-0 h-full w-full" />
        {(!pickup || !drop) && <div className="absolute inset-0 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>}
      </div>
      <p className="border-t bg-background px-3 py-1.5 text-[11px] text-muted-foreground">
        Google road route · {gpsLive ? "real driver GPS" : "driver GPS unavailable — location will appear when the driver's phone shares it"}
      </p>
    </div>
  );
}
