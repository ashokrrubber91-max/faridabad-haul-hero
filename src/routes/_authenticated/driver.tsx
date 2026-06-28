import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Loader2, MapPin, Truck, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { vehicleLabel, STATUS_META } from "@/lib/booking";

export const Route = createFileRoute("/_authenticated/driver")({
  head: () => ({ meta: [{ title: "Driver \u2014 MiniPort" }] }),
  component: DriverPage,
});

function DriverPage() {
  const { user, role, roles, activeMode, loading } = useAuth();
  const qc = useQueryClient();

  const queue = useQuery({
    queryKey: ["driver-feed", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .or(`status.eq.pending,driver_id.eq.${user!.id}`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("driver-bookings")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () => {
        qc.invalidateQueries({ queryKey: ["driver-feed", user.id] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, qc]);

  const accept = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("bookings")
        .update({ driver_id: user!.id, status: "accepted" })
        .eq("id", id)
        .eq("status", "pending")
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Already taken by another driver");
      return data;
    },
    onSuccess: () => toast.success("You\u2019ve got the job!"),
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "in_progress" | "completed" }) => {
      const { error } = await supabase.from("bookings").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading) return <Center><Loader2 className="h-5 w-5 animate-spin text-primary" /></Center>;
  if (role && role !== "driver" && role !== "admin") return <Navigate to="/customer" />;
  // Dual-role: driver-capable user has flipped back to customer mode.
  if (role !== "admin" && roles.includes("driver") && activeMode === "customer") {
    return <Navigate to="/customer" />;
  }

  const pending = (queue.data ?? []).filter((b) => b.status === "pending");
  const mine = (queue.data ?? []).filter((b) => b.driver_id === user?.id && b.status !== "pending");
  const isOnline = profile?.is_online ?? false;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayCompleted = mine.filter(
    (b) => b.status === "completed" && new Date(b.updated_at ?? b.created_at) >= today,
  );
  const todayEarnings = todayCompleted.reduce((sum, b) => sum + Number(b.fare || 0), 0);
  const activeJob = mine.find((b) => b.status === "accepted" || b.status === "in_progress");

  return (
    <div className="space-y-6">
      <section className="surface-card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          {isOnline ? (
            <Wifi className="h-5 w-5 text-success" />
          ) : (
            <WifiOff className="h-5 w-5 text-muted-foreground" />
          )}
          <div>
            <p className="font-display text-base tracking-wide text-secondary">
              {isOnline ? "Online" : "Offline"}
            </p>
            <p className="text-xs text-muted-foreground">
              {isOnline ? "Job requests will appear below" : "Go online to receive jobs"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Today</p>
            <p className="font-display text-xl text-secondary">
              \u20b9{todayEarnings.toFixed(0)}
              <span className="ml-1 text-xs text-muted-foreground">· {todayCompleted.length} trips</span>
            </p>
          </div>
          <Switch
            checked={isOnline}
            onCheckedChange={(v) => setOnline.mutate(v)}
            disabled={setOnline.isPending}
            aria-label="Toggle online"
          />
        </div>
      </section>

      {activeJob && (
        <section className="surface-card border-l-4 border-l-primary p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Active job</p>
          <p className="mt-1 text-sm font-medium text-secondary">{activeJob.pickup_address}</p>
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <ArrowRight className="h-3 w-3" /> {activeJob.drop_address}
          </p>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-2xl tracking-wide text-secondary">Live requests</h2>
          <Badge className="bg-warning text-warning-foreground hover:bg-warning">{pending.length} waiting</Badge>
        </div>
        {pending.length === 0 ? (
          <div className="surface-card p-6 text-center text-sm text-muted-foreground">
            <Truck className="mx-auto mb-2 h-5 w-5" />
            No pending requests. Stay tuned.
          </div>
        ) : (
          <div className="grid gap-3">
            {pending.map((b) => (
              <div key={b.id} className="surface-card border-l-4 border-l-primary p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{vehicleLabel(b.vehicle_type)} \u00b7 {b.distance_km} km</p>
                    <p className="mt-1 flex items-start gap-1.5 text-sm font-medium text-secondary">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />{b.pickup_address}
                    </p>
                    <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                      <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />{b.drop_address}
                    </p>
                    {b.notes && <p className="mt-1 text-xs italic text-muted-foreground">"{b.notes}"</p>}
                  </div>
                  <div className="text-right">
                    <p className="font-display text-2xl text-secondary">\u20b9{Number(b.fare).toFixed(0)}</p>
                    <Button size="sm" className="mt-2 h-9" onClick={() => accept.mutate(b.id)} disabled={accept.isPending}>
                      Accept
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-display text-2xl tracking-wide text-secondary">My jobs</h2>
        {mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">Jobs you accept will appear here.</p>
        ) : (
          <div className="grid gap-3">
            {mine.map((b) => {
              const meta = STATUS_META[b.status];
              return (
                <div key={b.id} className="surface-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">{vehicleLabel(b.vehicle_type)} \u00b7 {b.distance_km} km</p>
                      <p className="truncate text-sm font-medium text-secondary">{b.pickup_address}</p>
                      <p className="flex items-center gap-1 truncate text-sm text-muted-foreground">
                        <ArrowRight className="h-3 w-3" /> {b.drop_address}
                      </p>
                    </div>
                    <Badge className="bg-primary text-primary-foreground hover:bg-primary">{meta.label}</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    {b.status === "accepted" && (
                      <Button size="sm" variant="secondary" onClick={() => setStatus.mutate({ id: b.id, status: "in_progress" })}>
                        Start trip
                      </Button>
                    )}
                    {b.status === "in_progress" && (
                      <Button size="sm" onClick={() => setStatus.mutate({ id: b.id, status: "completed" })}>
                        Mark completed
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex justify-center py-10">{children}</div>;
}
