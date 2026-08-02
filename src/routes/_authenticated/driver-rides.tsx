import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Camera, Loader2, Package } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { STATUS_META, vehicleLabel } from "@/lib/booking";

export const Route = createFileRoute("/_authenticated/driver-rides")({
  head: () => ({
    meta: [
      { title: "My Rides — MiniPort Driver" },
      { name: "description", content: "Your complete MiniPort ride history with fares, commission and net earnings." },
      { property: "og:title", content: "My Rides — MiniPort Driver" },
      { property: "og:description", content: "Every trip you've completed, with earnings and proof of delivery." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DriverRidesPage,
});

function DriverRidesPage() {
  const { user } = useAuth();

  const rides = useQuery({
    queryKey: ["driver-rides", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("driver_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const list = rides.data ?? [];
  const completed = list.filter((b) => b.status === "completed");
  const totalNet = completed.reduce((s, b) => s + Number(b.driver_net_earning || 0), 0);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-3xl tracking-wide text-secondary">My rides</h1>
        <p className="text-sm text-muted-foreground">
          {completed.length} completed · ₹{totalNet.toFixed(0)} net earned
        </p>
      </header>

      {rides.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : list.length === 0 ? (
        <div className="surface-card p-8 text-center text-sm text-muted-foreground">
          <Package className="mx-auto mb-2 h-5 w-5" />
          No rides yet. Go online on the Home tab to start receiving jobs.
        </div>
      ) : (
        <div className="grid gap-3">
          {list.map((b) => (
            <RideCard key={b.id} ride={b} />
          ))}
        </div>
      )}
    </div>
  );
}

function RideCard({ ride }: { ride: Record<string, any> }) {
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const meta = STATUS_META[ride.status] ?? { label: ride.status };
  const commission = Number(ride.commission_amount || 0);
  const net = Number(ride.driver_net_earning || 0);

  const viewProof = async () => {
    setBusy(true);
    const { data, error } = await supabase.storage.from("delivery-proof").createSignedUrl(ride.pod_photo_url, 300);
    setBusy(false);
    if (!error && data) setProofUrl(data.signedUrl);
  };

  return (
    <article className="surface-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {new Date(ride.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} ·{" "}
            {vehicleLabel(ride.vehicle_type)} · {ride.distance_km} km
          </p>
          <p className="truncate text-sm font-medium text-secondary">{ride.pickup_address}</p>
          <p className="flex items-center gap-1 truncate text-sm text-muted-foreground">
            <ArrowRight className="h-3 w-3" /> {ride.drop_address}
          </p>
        </div>
        <Badge variant={ride.status === "cancelled" ? "destructive" : "default"}>{meta.label}</Badge>
      </div>

      {ride.status === "completed" && (
        <div className="mt-3 rounded-md bg-muted/40 px-3 py-2 text-xs">
          <div className="flex justify-between">
            <span>Total ride fare</span>
            <span>₹{Number(ride.fare).toFixed(0)}</span>
          </div>
          <div className="flex justify-between text-destructive">
            <span>Miniport commission</span>
            <span>−₹{commission.toFixed(0)}</span>
          </div>
          <div className="mt-1 flex justify-between border-t border-border pt-1 font-semibold text-success">
            <span>Your net earning</span>
            <span>₹{net.toFixed(0)}</span>
          </div>
        </div>
      )}

      {ride.pod_photo_url && (
        <div className="mt-3">
          {proofUrl ? (
            <img src={proofUrl} alt="Proof of delivery photo" loading="lazy" className="max-h-56 rounded-md border border-border object-cover" />
          ) : (
            <Button size="sm" variant="outline" onClick={viewProof} disabled={busy}>
              <Camera className="h-3.5 w-3.5" /> {busy ? "Loading…" : "View proof of delivery"}
            </Button>
          )}
        </div>
      )}
    </article>
  );
}
