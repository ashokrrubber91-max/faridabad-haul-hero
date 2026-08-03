import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MapPin, ArrowRight, Package, Loader2, ChevronRight, Map as MapIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { VEHICLES, estimateFare, vehicleLabel, STATUS_META, routeDistanceKm, type VehicleId } from "@/lib/booking";
import { VehicleCard } from "@/components/booking/VehicleCard";
import { WaypointManager } from "@/components/booking/WaypointManager";
import { GstinSelect, type CustomerGstin } from "@/components/booking/GstinSelect";
import { ReviewBooking } from "@/components/booking/ReviewBooking";
import { LocationSearchOverlay, type PlacePick } from "@/components/booking/LocationSearchOverlay";
import { MapPinConfirm } from "@/components/booking/MapPinConfirm";
import { LiveTripMap } from "@/components/booking/LiveTripMap";
import { CheckoutExtras, type PaymentMethod } from "@/components/booking/CheckoutExtras";
import { SupportChat } from "@/components/support/SupportChat";
import { FARIDABAD_CENTER } from "@/lib/google-maps";
import { LoadingTimerCard } from "@/components/booking/LoadingTimerCard";
import { canCancel, cancellationQuote } from "@/lib/cancellation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export const Route = createFileRoute("/_authenticated/customer")({
  head: () => ({ meta: [{ title: "Book a truck — MiniPort" }] }),
  component: CustomerPage,
});

type Stage = { type: "search" | "confirm"; mode: "pickup" | "drop" } | null;

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
  const [cancelTarget, setCancelTarget] = useState<{
    id: string;
    addr: string;
    status: string;
    fare: number;
    since: string;
  } | null>(null);
  const [cancelReason, setCancelReason] = useState("Driver taking too long");
  const [cancelNote, setCancelNote] = useState("");
  const [stops, setStops] = useState<PlacePick[]>([]);
  const [stopStage, setStopStage] = useState<null | { type: "search" | "confirm" }>(null);
  const [pendingStop, setPendingStop] = useState<PlacePick | null>(null);
  const [step, setStep] = useState<"form" | "review">("form");
  const [gstinEnabled, setGstinEnabled] = useState(false);
  const [gstinId, setGstinId] = useState<string | null>(null);

  const distanceKm = useMemo(() => {
    if (!pickup || !drop) return 0;
    return routeDistanceKm([pickup, ...stops, drop]);
  }, [pickup, drop, stops]);
  const baseFare = estimateFare(vehicle, distanceKm);
  const discount = Math.min(baseFare, (promo?.discount ?? 0) + coins);
  const fare = Math.max(0, baseFare - discount);

  const gstins = useQuery({
    queryKey: ["customer-gstins", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("customer_gstins").select("*").order("is_default", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CustomerGstin[];
    },
  });
  const selectedGstin = gstinEnabled ? (gstins.data ?? []).find((g) => g.id === gstinId) ?? null : null;

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
            stops.length > 0 && `Stops: ${stops.map((s) => s.address).join(" → ")}`,
            pickup.contactName && `Sender: ${pickup.contactName} (${pickup.contactPhone ?? ""})`,
            drop.contactName && `Receiver: ${drop.contactName} (${drop.contactPhone ?? ""})`,
            selectedGstin && `Billed to GSTIN ${selectedGstin.gstin} (${selectedGstin.business_name})`,
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
      setStops([]);
      setNotes("");
      setPromo(null);
      setCoins(0);
      setGstinEnabled(false);
      setGstinId(null);
      setStep("form");
      qc.invalidateQueries({ queryKey: ["my-bookings", user?.id] });
      qc.invalidateQueries({ queryKey: ["wallet", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: async ({
      id,
      reason,
      existingNotes,
      fee,
    }: {
      id: string;
      reason: string;
      existingNotes: string | null;
      fee: number;
    }) => {
      const noteLine =
        `Cancelled by customer: ${reason}` + (fee > 0 ? ` · Cancellation charge ₹${fee}` : " · No charge");
      const nextNotes = existingNotes ? `${existingNotes} · ${noteLine}` : noteLine;
      const { error } = await supabase
        .from("bookings")
        .update({ status: "cancelled", notes: nextNotes })
        .eq("id", id);
      if (error) throw error;
      return fee;
    },
    onSuccess: (fee) => {
      toast.success(fee > 0 ? `Booking cancelled — ₹${fee} cancellation charge applied` : "Booking cancelled — no charge");
      setCancelTarget(null);
      setCancelNote("");
      qc.invalidateQueries({ queryKey: ["wallet", user?.id] });
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
      {step === "form" ? (
      <section className="surface-card p-5">
        <h2 className="font-display text-2xl tracking-wide text-secondary">New booking</h2>
        <p className="text-sm text-muted-foreground">Faridabad only · transparent flat fare</p>

        <div className="mt-5 space-y-4">
          <LocationRow
            label="Pickup"
            dotClass="text-primary"
            place={pickup}
            placeholder="Search pickup location"
            onSearch={() => openSearch("pickup")}
            onPickOnMap={() => {
              setPending(pickup ?? { address: "", ...FARIDABAD_CENTER });
              setStage({ type: "confirm", mode: "pickup" });
            }}
          />

          <WaypointManager
            stops={stops}
            onAdd={() => setStopStage({ type: "search" })}
            onRemove={(i) => setStops((prev) => prev.filter((_, idx) => idx !== i))}
            onMoveUp={(i) =>
              setStops((prev) => {
                if (i === 0) return prev;
                const next = [...prev];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                return next;
              })
            }
            onMoveDown={(i) =>
              setStops((prev) => {
                if (i === prev.length - 1) return prev;
                const next = [...prev];
                [next[i + 1], next[i]] = [next[i], next[i + 1]];
                return next;
              })
            }
          />

          <LocationRow
            label="Drop"
            dotClass="text-success"
            place={drop}
            placeholder="Search drop location"
            onSearch={() => openSearch("drop")}
            onPickOnMap={() => {
              setPending(drop ?? { address: "", ...FARIDABAD_CENTER });
              setStage({ type: "confirm", mode: "drop" });
            }}
          />


          <div>
            <Label>Vehicle</Label>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {VEHICLES.map((v) => (
                <VehicleCard key={v.id} id={v.id} selected={vehicle === v.id} onSelect={() => setVehicle(v.id)} />
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

          <GstinSelect
            enabled={gstinEnabled}
            setEnabled={setGstinEnabled}
            selectedId={gstinId}
            setSelectedId={setGstinId}
          />

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
              <Button
                onClick={() => setStep("review")}
                disabled={!pickup || !drop || distanceKm <= 0}
                className="h-11"
              >
                Review booking
              </Button>
            </div>
          </div>
        </div>
      </section>
      ) : (
        pickup && drop && (
          <ReviewBooking
            pickup={pickup}
            drop={drop}
            stops={stops}
            vehicle={vehicle}
            distanceKm={distanceKm}
            baseFare={baseFare}
            discount={discount}
            fare={fare}
            notes={notes}
            gstin={selectedGstin}
            onBack={() => setStep("form")}
            onConfirm={() => create.mutate()}
            submitting={create.isPending}
          />
        )
      )}

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
                  {(b.status === "accepted" || b.status === "in_progress") && (
                    <LiveTripMap
                      pickupAddress={b.pickup_address}
                      dropAddress={b.drop_address}
                      phase={b.status === "accepted" ? "accepted" : "in_progress"}
                      distanceKm={Number(b.distance_km) || 0}
                    />
                  )}
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
                  {canCancel(b.status) && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">
                        {cancellationQuote(b.status, b.fare, b.updated_at).label}
                      </p>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() =>
                          setCancelTarget({
                            id: b.id,
                            addr: b.pickup_address,
                            status: b.status,
                            fare: Number(b.fare) || 0,
                            since: b.updated_at ?? b.created_at,
                          })
                        }
                        disabled={cancel.isPending}
                      >
                        <X className="h-3.5 w-3.5" /> Cancel Booking
                      </Button>
                    </div>
                  )}

                </div>
              );
            })}
          </div>
        )}
      </section>

      <Dialog
        open={!!cancelTarget}
        onOpenChange={(v) => {
          if (!v) {
            setCancelTarget(null);
            setCancelNote("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this booking?</DialogTitle>
            <DialogDescription className="truncate">{cancelTarget?.addr}</DialogDescription>
          </DialogHeader>
          {cancelTarget && (() => {
            const q = cancellationQuote(cancelTarget.status, cancelTarget.fare, cancelTarget.since);
            return (
              <div
                className={`rounded-md border p-3 text-sm ${
                  q.fee > 0 ? "border-destructive/40 bg-destructive/5" : "border-success/40 bg-success/5"
                }`}
              >
                <p className={`font-semibold ${q.fee > 0 ? "text-destructive" : "text-success"}`}>{q.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{q.detail}</p>
                {q.fee > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    The charge is settled from your wallet and may show a negative balance (e.g. −₹{q.fee}) until your
                    next booking.
                  </p>
                )}
              </div>
            );
          })()}
          <RadioGroup value={cancelReason} onValueChange={setCancelReason} className="space-y-2">
            {[
              "Driver taking too long",
              "Booked by mistake",
              "Changed my plan",
              "Wrong pickup or drop",
              "Other",
            ].map((r) => (
              <label key={r} className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm">
                <RadioGroupItem value={r} /> {r}
              </label>
            ))}
          </RadioGroup>
          {cancelReason === "Other" && (
            <Textarea
              placeholder="Tell us more (optional)"
              value={cancelNote}
              onChange={(e) => setCancelNote(e.target.value)}
              rows={2}
              maxLength={200}
            />
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelTarget(null)}>Keep booking</Button>
            <Button
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => {
                if (!cancelTarget) return;
                const reason = cancelReason === "Other" && cancelNote.trim() ? cancelNote.trim() : cancelReason;
                const existing = (bookings.data ?? []).find((x) => x.id === cancelTarget.id)?.notes ?? null;
                const { fee } = cancellationQuote(cancelTarget.status, cancelTarget.fare, cancelTarget.since);
                cancel.mutate({ id: cancelTarget.id, reason, existingNotes: existing, fee });
              }}
            >
              Confirm cancel
            </Button>

          </DialogFooter>
        </DialogContent>
      </Dialog>


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
      <LocationSearchOverlay
        open={stopStage?.type === "search"}
        onOpenChange={(v) => !v && setStopStage(null)}
        mode="drop"
        onPick={(p) => {
          setPendingStop(p);
          setStopStage({ type: "confirm" });
        }}
      />
      <MapPinConfirm
        open={stopStage?.type === "confirm"}
        onOpenChange={(v) => !v && setStopStage(null)}
        mode="drop"
        initial={pendingStop}
        onConfirm={(p) => {
          setStops((prev) => [...prev, p]);
          setPendingStop(null);
          setStopStage(null);
        }}
      />
      <SupportChat role="customer" />
    </div>
  );
}

function LocationRow({
  label,
  dotClass,
  place,
  placeholder,
  onSearch,
  onPickOnMap,
}: {
  label: string;
  dotClass: string;
  place: PlacePick | null;
  placeholder: string;
  onSearch: () => void;
  onPickOnMap: () => void;
}) {
  return (
    <div className="flex items-stretch gap-2">
      <button
        type="button"
        onClick={onSearch}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md border bg-background p-3 text-left transition-colors hover:bg-muted"
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
      <Button
        type="button"
        variant="outline"
        onClick={onPickOnMap}
        className="h-auto shrink-0 px-3"
        title="Select pin on map"
      >
        <MapIcon className="h-4 w-4" />
      </Button>
    </div>
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
