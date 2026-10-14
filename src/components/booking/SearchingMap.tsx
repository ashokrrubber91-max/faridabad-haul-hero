import { useEffect, useRef, useState } from "react";
import { MapPin, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FARIDABAD_CENTER, loadGoogleMaps } from "@/lib/google-maps";

export function SearchingMap({ latitude, longitude, address, scanning }: {
  latitude?: number | null;
  longitude?: number | null;
  address?: string;
  scanning: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    let marker: google.maps.Marker | undefined;
    setError(false);
    void loadGoogleMaps().then(async (g) => {
      let center = FARIDABAD_CENTER;
      if (latitude != null && longitude != null) center = { lat: latitude, lng: longitude };
      else if (address) {
        const result = await new g.maps.Geocoder().geocode({ address, region: "IN" });
        const point = result.results[0]?.geometry.location;
        if (!point) throw new Error("Pickup not located");
        center = { lat: point.lat(), lng: point.lng() };
      }
      if (disposed || !container.current) return;
      const map = new g.maps.Map(container.current, {
        center, zoom: 15, disableDefaultUI: true, zoomControl: true,
        clickableIcons: false, gestureHandling: "greedy",
      });
      marker = new g.maps.Marker({ map, position: center, title: address ?? "Pickup" });
    }).catch(() => { if (!disposed) setError(true); });
    return () => { disposed = true; marker?.setMap(null); };
  }, [latitude, longitude, address, attempt]);
  return (
    <div className="absolute inset-0 bg-muted">
      <div ref={container} className="absolute inset-0" aria-label="Interactive pickup map" />
      {error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted px-8 text-center">
          <MapPin className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Map unavailable. Your ride status is still updating.</p>
          <Button variant="outline" size="sm" onClick={() => setAttempt((v) => v + 1)}>Retry map</Button>
        </div>
      ) : scanning ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
          <div className="relative grid h-48 w-48 place-items-center">
            <span className="ride-radar" /><span className="ride-radar ride-radar-delayed" />
            <span className="grid h-14 w-14 place-items-center rounded-full border-4 border-card bg-primary text-primary-foreground shadow-lg"><Truck className="h-6 w-6" /></span>
          </div>
        </div>
      ) : null}
    </div>
  );
}