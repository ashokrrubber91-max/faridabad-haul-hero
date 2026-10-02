import { useEffect, useState } from "react";
import { WifiOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { flushOfflineQueue } from "@/lib/offline-queue";
import { supabase } from "@/integrations/supabase/client";

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pending, setPending] = useState(0);

  const refresh = async () => {
    setOffline(typeof navigator !== "undefined" && !navigator.onLine);
    const result = await flushOfflineQueue(async (item) => {
      if (item.kind === "driver_location") {
        const { error } = await supabase.from("driver_locations").upsert(item.payload, { onConflict: "driver_id" });
        if (error) throw error;
      } else if (item.kind === "pod_upload" && item.blob) {
        const bucket = String(item.payload.bucket || "delivery-proof");
        const path = String(item.payload.path);
        const { error } = await supabase.storage.from(bucket).upload(path, item.blob, { upsert: false, contentType: item.blob.type });
        if (error) throw error;
      }
    });
    setPending(result.pending);
  };

  useEffect(() => {
    void refresh();
    const on = () => void refresh();
    window.addEventListener("online", on);
    window.addEventListener("miniport:offline-ready", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("miniport:offline-ready", on);
    };
  }, []);

  if (!offline && pending === 0) return null;

  return (
    <div className="sticky top-0 z-50 border-b bg-warning/95 px-4 py-2 text-xs text-warning-foreground backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-2">
        <WifiOff className="h-4 w-4 shrink-0" />
        <span className="flex-1">
          {offline ? "Working Offline — data will sync automatically." : pending + " item" + (pending === 1 ? "" : "s") + " waiting to sync."}
        </span>
        <Button size="sm" variant="outline" disabled={syncing} onClick={async () => { setSyncing(true); await refresh(); setSyncing(false); }}>
          <RefreshCw className={syncing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Retry Sync
        </Button>
      </div>
    </div>
  );
}
