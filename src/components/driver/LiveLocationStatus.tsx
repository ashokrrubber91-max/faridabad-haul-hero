import { useEffect, useState } from "react";
import { LocateFixed, LocateOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { isStaleFix } from "@/lib/geolocation";

/**
 * Honest state of the driver's live location sharing. It reports what the device
 * actually reported — MiniPort cannot unblock an Android or browser permission
 * itself, so a blocked device is told exactly what to change.
 */
export function LiveLocationStatus() {
  const { locationShare } = useAuth();
  const [, tick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  if (locationShare.state === "idle") return null;

  const stale = locationShare.state === "live" && isStaleFix(locationShare.lastFixAt);
  const isError = locationShare.state === "error";
  const tone = isError
    ? "border-destructive/40 bg-destructive/10 text-destructive"
    : stale
      ? "border-warning/40 bg-warning/10 text-warning-foreground"
      : "border-success/40 bg-success/10 text-success-foreground";

  const headline = isError
    ? "Live location is not being shared"
    : locationShare.state === "starting"
      ? "Getting your live location…"
      : stale
        ? "Live location is out of date"
        : "Live location is on";

  const detail =
    locationShare.message ??
    (stale
      ? "Your last update is over a minute old. Keep GPS on and MiniPort open on screen."
      : locationShare.state === "live"
        ? "Customers can see you approaching."
        : null);

  return (
    <div className={`mb-3 flex items-start gap-2 rounded-md border p-3 text-sm ${tone}`}>
      {locationShare.state === "starting" ? (
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
      ) : isError ? (
        <LocateOff className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <LocateFixed className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{headline}</p>
        {detail && <p className="text-xs opacity-90">{detail}</p>}
      </div>
      {(isError || stale) && (
        <Button size="sm" variant="outline" onClick={locationShare.retry}>
          Retry
        </Button>
      )}
    </div>
  );
}
