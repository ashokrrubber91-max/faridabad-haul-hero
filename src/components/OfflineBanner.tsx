import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/** Tells the user plainly when the phone has lost its connection. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center gap-2 bg-destructive px-4 py-2 text-xs font-semibold text-destructive-foreground">
      <WifiOff className="h-3.5 w-3.5" />
      No internet connection — we&apos;ll reconnect automatically.
    </div>
  );
}
