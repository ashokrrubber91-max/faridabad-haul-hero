import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MapPin, ArrowRight, Package, Loader2, ChevronRight, Map as MapIcon, Navigation, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { VEHICLES, estimateFare, vehicleLabel, STATUS_META, type VehicleId } from "@/lib/booking";
import { LocationSearchOverlay, type PlacePick } from "@/components/booking/LocationSearchOverlay";
import { MapPinConfirm } from "@/components/booking/MapPinConfirm";
import { CheckoutExtras, type PaymentMethod } from "@/components/booking/CheckoutExtras";
import { SupportChat } from "@/components/support/SupportChat";
import { FARIDABAD_CENTER } from "@/lib/google-maps";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export const Route = createFileRoute("/_authenticated/customer")({
  head: () => ({ meta: [{ title: "Book a truck — MiniPort" }] }),
  component: CustomerPage,
});

type Stage = { type: "search" | "confirm"; mode: "pickup" | "drop" } | null;

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function CustomerPage() {
  const { user, role, roles, activeMode, loading } = useAuth();
  const qc = useQueryClient();
  const [vehicle, setVehicle] = useState<VehicleId>("tata_ace");
  const [pickup, setPickup] = useState<PlacePick | null>(null);
  const [drop, setDrop] = useState<PlacePick | null>(null);
  const [notes, setNotes] = useState("");
  const [stage, setStage] = useState<Stage>(null);
  const [pending, setPending] = useState<PlacePick | null>(null);
  const [promo, setPromo] = useState<{ code: string; discount: number } | null>(null);
  const [coins, setCoins] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>("cod");
  const [cancelTarget, setCancelTarget] = useState<{ id: string; addr: string } | null>(null);
  const [cancelReason, setCancelReason] = useState("Driver taking too long");
  const [cancelNote, setCancelNote] = useState("");

  const distanceKm = useMemo(() => {
    if (!pickup || !drop) return 0;
    // road factor ~1.3 over straight-line distance
    return Math.max(0.5, +(haversineKm(pickup, drop) * 1.3).toFixed(1));
  }, [pickup, drop]);
  const baseFare = estimateFare(vehicle, distanceKm);
  const discount = Math.min(baseFare, (promo?.discount ?? 0) + coins);
  const fare = Math.max(0, baseFare - discount);

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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings", filter: `customer_id=eq.${user.id}` },
        () => {
          qc.invalidateQueries({ queryKey: ["my-bookings", user.id] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user, qc]);

  const create = useMutation({
    mutationFn: async () => {
      if (!pickup) throw new Error("Choose pickup location");
      if (!drop) throw new Error("Choose drop location");
      if (distanceKm <= 0) throw new Error("Invalid distance");
      const { error } = await supabase.from("bookings").insert({
        customer_id: user!.id,
        pickup_address: pickup.address,
        drop_address: drop.address,
        vehicle_type: vehicle,
        distance_km: distanceKm,
        fare,
        coupon_code: promo?.code ?? null,
        coupon_discount: promo?.discount ?? 0,
        coins_redeemed: coins,
        payment_method: method,
        notes:
          [
            notes.trim(),
            pickup.contactName && `Sender: ${pickup.contactName} (${pickup.contactPhone ?? ""})`,
            drop.contactName && `Receiver: ${drop.contactName} (${drop.contactPhone ?? ""})`,
          ]
            .filter(Boolean)
            .join(" · ") || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Booking placed — finding a driver");
      setPickup(null);
      setDrop(null);
      setNotes("");
      setPromo(null);
      setCoins(0);
      qc.invalidateQueries({ queryKey: ["my-bookings", user?.id] });
      qc.invalidateQueries({ queryKey: ["wallet", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: async ({ id, reason, existingNotes }: { id: string; reason: string; existingNotes: string | null }) => {
      const noteLine = `Cancelled by customer: ${reason}`;
      const nextNotes = existingNotes ? `${existingNotes} · ${noteLine}` : noteLine;
      const { error } = await supabase
        .from("bookings")
        .update({ status: "cancelled", notes: nextNotes })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Booking cancelled");
      setCancelTarget(null);
      setCancelNote("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading) return <CenterLoader />;
  if (role && role !== "customer" && role !== "admin") {
    return <Navigate to={role === "driver" ? "/driver" : "/admin"} />;
  }
  // Dual-role only: user has BOTH customer and driver roles and switched into driver mode.
  if (role !== "admin" && roles.includes("driver") && roles.includes("customer") && activeMode === "driver") {
    return <Navigate to="/driver" />;
  }

  const openSearch = (mode: "pickup" | "drop") => setStage({ type: "search", mode });

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      <section className="surface-card p-5">
        <h2 className="font-display text-2xl tracking-wide text-secondary">New booking</h2>
        <p className="text-sm text-muted-foreground">Faridabad only · transparent flat fare</p>

        <div className="mt-5 space-y-4">
          <LocationButton
            label="Pickup"
            dotClass="text-primary"
            place={pickup}
            placeholder="Search pickup location"
            onClick={() => openSearch("pickup")}
          />
          <LocationButton
            label="Drop"
            dotClass="text-success"
            place={drop}
            placeholder="Search drop location"
            onClick={() => openSearch("drop")}
          />

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
                    <p className="text-xs text-muted-foreground">
                      Up to {v.capacity} · ₹{v.perKm}/km
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-muted-foreground">Base ₹{v.base}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="notes">Notes for driver (optional)</Label>
            <Textarea
              id="notes"
              rows={2}
              placeholder="2 mattresses + 1 sofa"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={300}
            />
          </div>

          <CheckoutExtras
            fare={baseFare}
            promo={promo}
            setPromo={setPromo}
            coins={coins}
            setCoins={setCoins}
            method={method}
            setMethod={setMethod}
          />

          <div className="rounded-md bg-secondary/95 px-4 py-3 text-secondary-foreground">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider opacity-80">
                  {distanceKm > 0 ? `${distanceKm} km · total` : "Estimated total"}
                </p>
                <p className="font-display text-3xl">₹ {fare || "—"}</p>
                {discount > 0 && (
                  <p className="text-xs opacity-80">Base ₹{baseFare} − ₹{discount} off</p>
                )}
              </div>
              <Button onClick={() => create.mutate()} disabled={create.isPending} className="h-11">
                {create.isPending ? "Booking…" : "Book now"}
              </Button>
            </div>
          </div>
        </div>
      </section>


      <section>
        <h2 className="mb-3 font-display text-2xl tracking-wide text-secondary">Your bookings</h2>
        {bookings.isLoading ? (
          <CenterLoader />
        ) : (
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
                        <span>·</span>
                        <span>{b.distance_km} km</span>
                      </div>
                      <p className="mt-1 truncate text-sm font-medium text-secondary">{b.pickup_address}</p>
                      <p className="flex items-center gap-1 truncate text-sm text-muted-foreground">
                        <ArrowRight className="h-3 w-3" /> {b.drop_address}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-display text-xl text-secondary">₹{Number(b.fare).toFixed(0)}</p>
                      <Badge
                        variant={meta.tone === "destructive" ? "destructive" : "secondary"}
                        className={tone(meta.tone)}
                      >
                        {meta.label}
                      </Badge>
                    </div>
                  </div>
                  {(b.status === "accepted" || b.status === "in_progress") && (b.pickup_otp || b.drop_otp) && (
                    <div className="mt-3 grid gap-2 rounded-md bg-primary/5 p-3 sm:grid-cols-2">
                      {b.pickup_otp && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pickup OTP</p>
                          <p className="font-display text-2xl tracking-widest text-primary">{b.pickup_otp}</p>
                          <p className="text-[10px] text-muted-foreground">Share with driver at pickup</p>
                        </div>
                      )}
                      {b.drop_otp && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Drop OTP</p>
                          <p className="font-display text-2xl tracking-widest text-primary">{b.drop_otp}</p>
                          <p className="text-[10px] text-muted-foreground">Share only after delivery</p>
                        </div>
                      )}
                    </div>
                  )}
                  {b.status === "pending" && (
                    <div className="mt-3 flex justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => cancel.mutate(b.id)}
                        disabled={cancel.isPending}
                      >
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

      <LocationSearchOverlay
        open={stage?.type === "search"}
        onOpenChange={(v) => !v && setStage(null)}
        mode={stage?.mode ?? "pickup"}
        onPick={(p) => {
          setPending(p);
          setStage({ type: "confirm", mode: stage?.mode ?? "pickup" });
        }}
      />
      <MapPinConfirm
        open={stage?.type === "confirm"}
        onOpenChange={(v) => !v && setStage(null)}
        mode={stage?.mode ?? "pickup"}
        initial={pending}
        onConfirm={(p) => {
          if (stage?.mode === "pickup") setPickup(p);
          else setDrop(p);
          setPending(null);
          setStage(null);
        }}
      />
      <SupportChat role="customer" />
    </div>
  );
}

function LocationButton({
  label,
  dotClass,
  place,
  placeholder,
  onClick,
}: {
  label: string;
  dotClass: string;
  place: PlacePick | null;
  placeholder: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-md border bg-background p-3 text-left transition-colors hover:bg-muted"
    >
      <MapPin className={`h-4 w-4 shrink-0 ${dotClass}`} />
      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        {place ? (
          <>
            <p className="truncate text-sm font-medium text-secondary">
              {place.alias || place.address}
            </p>
            {place.alias && (
              <p className="truncate text-xs text-muted-foreground">{place.address}</p>
            )}
          </>
        ) : (
          <p className="truncate text-sm text-muted-foreground">{placeholder}</p>
        )}
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}

function tone(t: "warning" | "primary" | "success" | "muted" | "destructive") {
  switch (t) {
    case "warning":
      return "bg-warning text-warning-foreground hover:bg-warning";
    case "primary":
      return "bg-primary text-primary-foreground hover:bg-primary";
    case "success":
      return "bg-success text-success-foreground hover:bg-success";
    case "destructive":
      return "";
    default:
      return "";
  }
}

function CenterLoader() {
  return (
    <div className="flex justify-center py-10">
      <Loader2 className="h-5 w-5 animate-spin text-primary" />
    </div>
  );
}
