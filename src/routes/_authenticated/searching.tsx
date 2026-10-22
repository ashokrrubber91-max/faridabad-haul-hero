import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CreditCard,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  MapPin,
  ShieldCheck,
  TrendingUp,
  Truck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { BOOKING_FIELDS, vehicleLabel } from "@/lib/booking";
import { useVehicleTypes } from "@/lib/vehicles";
import { SearchingMap } from "@/components/booking/SearchingMap";
import { LiveTripMap } from "@/components/booking/LiveTripMap";
import { ActiveTripCard } from "@/components/booking/ActiveTripCard";
import { TripSafetyActions } from "@/components/booking/TripSafetyActions";

export const Route = createFileRoute("/_authenticated/searching")({
  validateSearch: (search: Record<string, unknown>) => ({
    bookingId: typeof search.bookingId === "string" ? search.bookingId : "",
  }),
  head: () => ({
    meta: [
      { title: "Live ride tracking — MiniPort" },
      { name: "description", content: "Follow your MiniPort captain search and live trip, with fare and pickup details." },
      { property: "og:title", content: "Live ride tracking — MiniPort" },
      { property: "og:description", content: "Your MiniPort ride, from captain search to delivery." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SearchingPage,
});

function SearchingPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { bookingId } = Route.useSearch();
  const qc = useQueryClient();
  const vehicles = useVehicleTypes();
  const [now, setNow] = useState(Date.now());
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveredId, setRecoveredId] = useState("");
  const [vehicleChoice, setVehicleChoice] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const booking = useQuery({
    queryKey: ["searching-booking", user?.id, bookingId],
    enabled: !!user && !!bookingId,
    queryFn: async () => {
      if (!user) throw new Error("Please sign in");
      const { data, error } = await supabase.from("bookings").select(BOOKING_FIELDS).eq("id", bookingId).eq("customer_id", user.id).single();
      if (error) throw error;
      return data;
    },
    staleTime: 10_000,
    refetchInterval: (query) => query.state.data && ["completed", "cancelled", "expired"].includes(query.state.data.status) ? false : 15_000,
  });
  useEffect(() => {
    const createdAt = booking.data?.created_at;
    if (!createdAt || booking.data?.status !== "pending") return;
    const delay = Math.max(0, new Date(booking.data?.scheduled_for ?? createdAt).getTime() + 60_000 - Date.now());
    setNow(Date.now());
    const timer = window.setTimeout(() => setNow(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [booking.data?.created_at, booking.data?.scheduled_for, booking.data?.status]);
  const userId = user?.id;
  const refetchBooking = booking.refetch;
  useEffect(() => {
    if (!userId || !bookingId) return;
    const channel = supabase.channel(`searching:${bookingId}`).on("postgres_changes", { event: "UPDATE", schema: "public", table: "bookings", filter: `id=eq.${bookingId}` }, () => { void refetchBooking(); }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [userId, bookingId, refetchBooking]);
  const b = booking.data;
  const searching = b?.status === "pending";
  const tracking = b?.status === "accepted" || b?.status === "in_progress";
  const elapsed = b ? Math.max(0, Math.floor((now - new Date(b.scheduled_for ?? b.created_at).getTime()) / 1000)) : 0;
  useEffect(() => {
    if (searching && elapsed >= 60 && recoveredId !== bookingId) { setRecoveredId(bookingId); setRecoveryOpen(true); }
    if (!searching) setRecoveryOpen(false);
  }, [searching, elapsed, bookingId, recoveredId]);
  const refresh = async () => {
    await booking.refetch();
    void qc.invalidateQueries({ queryKey: ["my-bookings"] });
    void qc.invalidateQueries({ queryKey: ["orders"] });
  };
  const boost = useMutation({
    mutationFn: async (amount: number) => {
      const { error } = await supabase.rpc("set_booking_fare_boost", { _booking_id: bookingId, _boost: amount });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => { await refresh(); toast.success("Fare boost updated"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const changeVehicle = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("change_searching_booking_vehicle", { _booking_id: bookingId, _vehicle_type: id });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => { await refresh(); setVehicleChoice(null); setRecoveryOpen(false); toast.success("Vehicle updated — your same ride is still searching"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const canChange = searching && b?.payment_status === "pending" && b.payment_method === "cod" && !b.coupon_code && Number(b.coins_redeemed ?? 0) === 0;
  const canCancelRide = !!b && ["pending", "accepted", "in_progress"].includes(b.status) && !b.cancelled_at;
  const busy = boost.isPending || changeVehicle.isPending || cancelBusy;
  const cancelRide = async () => {
    if (!b || !canCancelRide || cancelBusy) return;
    const reason = window.prompt("Why do you want to cancel this booking?", "Changed my plans");
    if (reason === null) return;
    if (reason.trim().length < 3) { toast.error("Please enter a cancellation reason (at least 3 characters)."); return; }
    setCancelBusy(true);
    try {
      const { error } = await supabase.rpc("cancel_booking", { _booking_id: b.id, _reason: reason.trim() });
      if (error) throw new Error(error.message);
      await refresh();
      setRecoveryOpen(false);
      toast.success("Booking cancelled.");
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: ["my-bookings"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cancel this booking.");
    } finally { setCancelBusy(false); }
  };
  const heading = !b ? "Connecting to logistics network…" : searching ? "Searching for nearby captains…" : tracking ? (b.status === "accepted" ? "Your captain is on the way" : "Your delivery is underway") : b.status === "scheduled" ? "Your pickup is scheduled" : b.status === "completed" ? "Delivered. All done." : "This ride has ended";
  return (
    <main className="fixed inset-0 z-40 flex h-dvh flex-col overflow-hidden bg-card text-foreground">
      <div className="relative min-h-[200px] flex-1">
        {tracking && b ? <LiveTripMap bookingId={b.id} driverId={b.driver_id} pickupAddress={b.pickup_address} dropAddress={b.drop_address} pickupLat={b.pickup_lat} pickupLng={b.pickup_lng} dropLat={b.drop_lat} dropLng={b.drop_lng} phase={b.status === "accepted" ? "accepted" : "in_progress"} distanceKm={Number(b.distance_km)} immersive /> : <SearchingMap latitude={b?.pickup_lat} longitude={b?.pickup_lng} address={b?.pickup_address} scanning={!!searching} />}
        <header className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <Button variant="outline" size="icon" className="pointer-events-auto rounded-full bg-card shadow-sm" aria-label="Back to My Rides" onClick={() => navigate({ to: "/orders" })}><ArrowLeft className="h-5 w-5" /></Button>
          <span className="rounded-full border bg-card/95 px-4 py-2 text-sm font-bold shadow-sm">MiniPort <span className="text-primary">/</span> Live ride</span>
          <Button variant="outline" size="icon" className="pointer-events-auto rounded-full bg-card shadow-sm" aria-label="Open ride history" onClick={() => navigate({ to: "/orders" })}><Truck className="h-5 w-5" /></Button>
        </header>
      </div>
      <section className="relative z-10 max-h-[62dvh] shrink-0 overflow-y-auto rounded-t-2xl border-t bg-card px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 sm:px-8">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" />
        <div className="mx-auto max-w-2xl">
          <div className="flex items-start justify-between gap-4" aria-live="polite">
            <div className="min-w-0"><p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-primary" /> {tracking ? "Captain connected" : "MiniPort logistics network"}</p><h1 className="text-2xl font-semibold leading-tight sm:text-3xl">{heading}</h1></div>
            {searching ? <Loader2 className="mt-6 h-6 w-6 shrink-0 animate-spin text-primary motion-reduce:animate-none" /> : b?.status === "completed" ? <CheckCircle2 className="mt-6 h-7 w-7 text-success" /> : null}
          </div>
          {booking.isError ? <div className="mt-4"><p className="text-sm text-muted-foreground">Couldn’t load this ride. Your booking has not been deleted.</p><Button variant="outline" className="mt-3" onClick={() => booking.refetch()}>Retry</Button></div> : b ? <>
            <div className="my-5 flex items-center justify-between gap-3 border-y py-4"><div className="flex min-w-0 items-center gap-3"><Truck className="h-6 w-6 shrink-0 text-primary" /><div><p className="text-sm font-semibold">{vehicleLabel(b.vehicle_type)}</p><p className="text-xs text-muted-foreground">{Number(b.distance_km).toFixed(1)} km · CRN {b.id.slice(0, 8).toUpperCase()}</p></div></div><p className="shrink-0 text-2xl font-bold">₹{Number(b.final_fare ?? b.fare).toFixed(0)}</p></div>
            <div className="my-3 flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3"><div className="flex items-center gap-2 text-sm"><CreditCard className="h-4 w-4 text-primary" /><span className="text-muted-foreground">Payment method</span></div><span className="text-sm font-semibold">{b.payment_method === "cod" ? "Cash on delivery" : b.payment_method === "wallet" ? "Wallet" : "Online payment"}</span></div>
            <div className="space-y-3 text-sm"><p className="flex items-start gap-3"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>{b.pickup_address}</span></p><p className="flex items-start gap-3"><ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><span>{b.drop_address}</span></p></div>
            {b.scheduled_for && <Badge variant="outline" className="mt-3 whitespace-normal"><Clock className="mr-1 h-3 w-3" /> Scheduled for {new Date(b.scheduled_for).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}</Badge>}
            {tracking && <ActiveTripCard bookingId={b.id} driverId={b.driver_id} vehicleType={b.vehicle_type} status={b.status === "accepted" ? "accepted" : "in_progress"} />}
            {tracking && <TripSafetyActions bookingId={b.id} pickupAddress={b.pickup_address} dropAddress={b.drop_address} phase={b.status === "accepted" ? "accepted" : "in_progress"} eta={null} />}
            {searching ? <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-muted-foreground">{elapsed < 60 ? "Checking available captains near your pickup" : "Still searching for an available captain"}</p><div className="flex gap-2"><Button variant="destructive" size="sm" disabled={busy || !canCancelRide} onClick={cancelRide}>{cancelBusy ? "Cancelling…" : "Cancel Booking"}</Button><Button variant="secondary" size="sm" onClick={() => setRecoveryOpen(true)}>Ride options <ChevronRight className="h-4 w-4" /></Button></div></div> : <div className="mt-5 flex flex-col gap-2 sm:flex-row"><Button variant="outline" className="flex-1" onClick={() => navigate({ to: "/orders" })}>View ride details <ArrowRight className="h-4 w-4" /></Button>{tracking && canCancelRide && <Button variant="destructive" className="flex-1" disabled={busy} onClick={cancelRide}>{cancelBusy ? "Cancelling…" : "Cancel active ride"}</Button>}</div>}
          </> : <div className="py-6 text-sm text-muted-foreground">{bookingId ? "Loading your pickup and trip details…" : "Choose a ride from My Rides to track it."}</div>}
        </div>
      </section>
      <Drawer open={recoveryOpen && !!searching} onOpenChange={setRecoveryOpen} shouldScaleBackground={false}>
        <DrawerContent className="mx-auto max-h-[85dvh] max-w-2xl overflow-y-auto bg-card pb-[max(1rem,env(safe-area-inset-bottom))]">
          <DrawerHeader className="relative px-6 text-left"><DrawerTitle className="pr-8 text-2xl">{elapsed >= 60 ? "Let’s get your ride moving" : "Your ride options"}</DrawerTitle><DrawerDescription>{elapsed >= 60 ? "No captain has accepted yet. Your booking is still active." : "Your booking stays active while you explore options."}</DrawerDescription><Button size="icon" variant="ghost" className="absolute right-3 top-2" aria-label="Close ride options" onClick={() => setRecoveryOpen(false)}><X className="h-4 w-4" /></Button></DrawerHeader>
          <div className="space-y-5 px-6 pb-4">
            {b && <div className="rounded-lg border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Current payment method</p><p className="mt-1 font-semibold">{b.payment_method === "cod" ? "Cash on delivery" : b.payment_method === "wallet" ? "Wallet" : "Online payment"}</p><p className="mt-1 text-xs text-muted-foreground">Payment method changes are available from the booking payment options before checkout.</p></div>}
            <Button variant="destructive" className="w-full" disabled={busy || !searching} onClick={cancelRide}>{cancelBusy ? "Cancelling…" : "Cancel Booking"}</Button>
            <div><h3 className="flex items-center gap-2 text-sm font-semibold"><TrendingUp className="h-4 w-4 text-primary" />Offer a fare boost</h3><div className="mt-3 grid grid-cols-4 gap-2">{[5, 25, 35, 45].map((amount) => <Button key={amount} variant={Number(b?.fare_boost) === amount ? "default" : "outline"} disabled={busy || b?.payment_status !== "pending"} onClick={() => boost.mutate(amount)}>+₹{amount}</Button>)}</div>{Number(b?.fare_boost) > 0 && <Button size="sm" variant="ghost" disabled={busy || b?.payment_status !== "pending"} onClick={() => boost.mutate(0)}>Remove boost</Button>}{b?.payment_status !== "pending" && <p className="mt-2 text-xs text-muted-foreground">Fare is locked after payment.</p>}</div>
            <div className="border-t pt-4"><h3 className="text-sm font-semibold">Try another vehicle</h3>{vehicles.isError ? <Button size="sm" variant="outline" onClick={() => vehicles.refetch()}>Retry vehicle list</Button> : <div className="mt-3 space-y-2">{(vehicles.data ?? []).filter((v) => v.id !== b?.vehicle_type && (b?.cargo_weight_kg == null || (v.payload_kg ?? v.weight_limit_kg ?? Infinity) >= Number(b.cargo_weight_kg))).map((v) => <Button key={v.id} variant={vehicleChoice === v.id ? "secondary" : "outline"} className="h-auto w-full justify-between whitespace-normal py-3 text-left" disabled={busy || !canChange} onClick={() => setVehicleChoice(v.id)}><span>{v.label}<span className="block text-xs font-normal opacity-70">{v.capacity_label}</span></span><ChevronRight className="h-4 w-4 shrink-0" /></Button>)}</div>}{!canChange && <p className="mt-2 text-xs text-muted-foreground">Vehicle changes are locked for online, paid, wallet-funded or discounted rides.</p>}{vehicleChoice && <Button className="mt-3 w-full" disabled={busy || !canChange} onClick={() => changeVehicle.mutate(vehicleChoice)}>{changeVehicle.isPending ? "Updating…" : `Switch to ${vehicleLabel(vehicleChoice)}`}</Button>}</div>
            <Button variant="ghost" className="w-full" onClick={() => setRecoveryOpen(false)}>Keep searching</Button>
          </div>
        </DrawerContent>
      </Drawer>
    </main>
  );
}
