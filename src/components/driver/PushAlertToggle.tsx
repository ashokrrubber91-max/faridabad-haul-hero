import { Bell, BellRing, BellOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePushNotifications } from "@/hooks/usePushNotifications";

/**
 * Lets a driver turn on background ride alerts, so a new job rings the phone
 * even when MiniPort is closed or the screen is locked.
 */
export function PushAlertToggle() {
  const { state, enable } = usePushNotifications();

  const copy = {
    unsupported: {
      title: "Background alerts unavailable",
      hint: "Open MiniPort in Chrome (Android or desktop) to receive alerts when the app is closed.",
    },
    idle: {
      title: "Turn on ride alerts",
      hint: "Get a ringing notification for new jobs even when the app is closed.",
    },
    enabling: { title: "Turning on alerts…", hint: "Allow notifications when your browser asks." },
    enabled: {
      title: "Ride alerts are on",
      hint: "New jobs will ring this device even when MiniPort is closed.",
    },
    denied: {
      title: "Alerts are blocked",
      hint: "Allow notifications for this site in your browser settings, then try again.",
    },
  }[state];

  const Icon = state === "enabled" ? BellRing : state === "denied" || state === "unsupported" ? BellOff : Bell;

  return (
    <section className="surface-card flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="flex items-center gap-3">
        <Icon
          className={`h-5 w-5 ${state === "enabled" ? "text-success" : state === "denied" ? "text-destructive" : "text-primary"}`}
        />
        <div>
          <p className="font-display text-base tracking-wide text-secondary">{copy.title}</p>
          <p className="text-xs text-muted-foreground">{copy.hint}</p>
        </div>
      </div>
      {state !== "enabled" && state !== "unsupported" && (
        <Button
          type="button"
          variant={state === "denied" ? "outline" : "default"}
          size="sm"
          onClick={enable}
          disabled={state === "enabling"}
        >
          {state === "enabling" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enable alerts"}
        </Button>
      )}
    </section>
  );
}
