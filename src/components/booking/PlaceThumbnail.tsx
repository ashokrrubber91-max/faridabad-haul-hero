import { useState } from "react";
import { MapPin } from "lucide-react";

/**
 * Small pickup-area picture. Real map imagery is only shown when the maps key
 * accepts this app's address; otherwise a plain neutral tile is shown. No
 * imagery is ever invented for a place we do not have real coordinates for.
 */
export function PlaceThumbnail({
  lat,
  lng,
  label,
  className = "h-16 w-24",
}: {
  lat?: number | null;
  lng?: number | null;
  label: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const key = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as string | undefined;
  const hasCoords = typeof lat === "number" && typeof lng === "number";
  const src =
    key && hasCoords
      ? `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=16&size=240x160&scale=2&markers=color:0xF97316%7C${lat},${lng}&key=${key}`
      : null;

  if (!src || failed) {
    return (
      <div
        className={`grid shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground ${className}`}
        aria-label={`${label} — no map picture available`}
      >
        <MapPin className="h-5 w-5" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={`Map of ${label}`}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-md border object-cover ${className}`}
    />
  );
}
