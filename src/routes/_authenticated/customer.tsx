import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { MapPin, ArrowRight, Package, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { VEHICLES, estimateFare, vehicleLabel, STATUS_META, type VehicleId } from "@/lib/booking";

export const Route = createFileRoute("/_authenticated/customer")({
  head: () => ({ meta: [{ title: "Book a truck \u2014 MiniPort" }] }),
  component: CustomerPage,
});

const bookingSchema = z.object({
  pickup: z.string().trim().min(4, "Enter pickup address").max(200),
  drop: z.string().trim().min(4, "Enter drop address").max(200),
  distance: z.coerce.number().positive("Distance must be > 0").max(80),
  notes: z.string().max(300).optional(),
});

function CustomerPage() {
  const { user, role, loading } = useAuth();
  const qc = useQueryClient();
  const [vehicle, setVehicle] = useState<VehicleId>("tata_ace");
  const [pickup, setPickup] = useState("");
  const [drop, setDrop] = useState("");
  const [distance, setDistance] = useState("");
  const [notes, setNotes] = useState("");

  const distanceNum = Number(distance);
  const fare = estimateFare(vehicle, isFinite(distanceNum) ? distanceNum : 0);

  const bookings = useQuery({
    queryKey: ["my-bookings", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("customer_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("cust-bookings")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: `customer_id=eq.${user.id}` }, () => {
        qc.invalidateQueries({ queryKey: ["my-bookings", user.id] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, qc]);

  const create = useMutation({
    mutationFn: async () => {
      const parsed = bookingSchema.safeParse({ pickup, drop, distance, notes });
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      const { error } = await supabase.from("bookings").insert({
        customer_id: user!.id,
        pickup_address: parsed.data.pickup,
        drop_address: parsed.data.drop,
        vehicle_type: vehicle,
        distance_km: parsed.data.distance,
        fare,
        notes: parsed.data.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Booking placed \u2014 finding a driver");
      setPickup(""); setDrop(""); setDistance(""); setNotes("");
      qc.invalidateQueries({ queryKey: ["my-bookings", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("bookings").update({ status: "cancelled" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => toast.success("Booking cancelled"),
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading) return <CenterLoader />;
  if (role && role !== "customer" && role !== "admin") {
    return <Navigate to={role === "driver" ? "/driver" : "/admin"} />;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      <section className="surface-card p-5">
        <h2 className="font-display text-2xl tracking-wide text-secondary">New booking</h2>
        <p className="text-sm text-muted-foreground">Faridabad only \u00b7 transparent flat fare</p>

        <div className="mt-5 space-y-4">
          <div>
            <Label htmlFor="pickup" className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-primary" /> Pickup</Label>
            <Input id="pickup" placeholder="House 21, Sector 15, Faridabad" value={pickup} onChange={(e) => setPickup(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="drop" className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-success" /> Drop</Label>
            <Input id="drop" placeholder="Plot 14, NIT, Faridabad" value={drop} onChange={(e) => setDrop(e.target.value)} />
          </div>

          <div>
            <Label>Vehicle</Label>
            <div className="mt-1 grid gap-2">
              {VEHICLES.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVehicle(v.id)}
                  className={`flex items-center justify-between rounded-md border p-3 text-left transition-colors ${
                    vehicle === v.id ? "border-primary bg-accent" : "border-border hover:bg-muted"
                  }`}
                >
                  <div>
                    <p className="text-sm font-semibold text-secondary">{v.label}</p>
                    <p className="text-xs text-muted-foreground">Up to {v.capacity} \u00b7 \u20b9{v.perKm}/km</p>
                  </div>
                  <span className="text-xs font-semibold text-muted-foreground">Base \u20b9{v.base}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="distance">Distance (km)</Label>
            <Input id="distance" inputMode="decimal" placeholder="e.g. 8.5" value={distance} onChange={(e) => setDistance(e.target.value)} />
          </div>

          <div>
            <Label htmlFor="notes">Notes for driver (optional)</Label>
            <Textarea id="notes" rows={2} placeholder="2 mattresses + 1 sofa" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />
          </div>

          <div className="flex items-center justify-between rounded-md bg-secondary/95 px-4 py-3 text-secondary-foreground">
            <div>
              <p className="text-xs uppercase tracking-wider opacity-80">Estimated fare</p>
              <p className="font-display text-3xl">\u20b9 {fare || "—"}</p>
            </div>
            <Button onClick={() => create.mutate()} disabled={create.isPending} className="h-11">
              {create.isPending ? "Booking\u2026" : "Book now"}
            </Button>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-display text-2xl tracking-wide text-secondary">Your bookings</h2>
        {bookings.isLoading ? <CenterLoader /> : (
          <div className="space-y-3">
            {(bookings.data ?? []).length === 0 && (
              <div className="surface-card p-6 text-center text-sm text-muted-foreground">
                <Package className="mx-auto mb-2 h-5 w-5" />
                No bookings yet. Place your first one.
              </div>
            )}
            {(bookings.data ?? []).map((b) => {
              const meta = STATUS_META[b.status] ?? STATUS_META.pending;
              return (
                <div key={b.id} className="surface-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{vehicleLabel(b.vehicle_type)}</span>
                        <span>\u00b7</span>
                        <span>{b.distance_km} km</span>
                      </div>
                      <p className="mt-1 truncate text-sm font-medium text-secondary">{b.pickup_address}</p>
                      <p className="flex items-center gap-1 truncate text-sm text-muted-foreground">
                        <ArrowRight className="h-3 w-3" /> {b.drop_address}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-display text-xl text-secondary">\u20b9{Number(b.fare).toFixed(0)}</p>
                      <Badge variant={meta.tone === "destructive" ? "destructive" : "secondary"} className={tone(meta.tone)}>
                        {meta.label}
                      </Badge>
                    </div>
                  </div>
                  {(b.status === "pending") && (
                    <div className="mt-3 flex justify-end">
                      <Button size="sm" variant="ghost" onClick={() => cancel.mutate(b.id)} disabled={cancel.isPending}>
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function tone(t: "warning" | "primary" | "success" | "muted" | "destructive") {
  switch (t) {
    case "warning": return "bg-warning text-warning-foreground hover:bg-warning";
    case "primary": return "bg-primary text-primary-foreground hover:bg-primary";
    case "success": return "bg-success text-success-foreground hover:bg-success";
    case "destructive": return "";
    default: return "";
  }
}

function CenterLoader() {
  return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
}
