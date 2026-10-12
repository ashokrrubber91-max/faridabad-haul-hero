import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, MapPin, Package, Truck, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { BOOKING_FIELDS, STATUS_META, vehicleLabel } from "@/lib/booking";
import { DriverMatchingCard } from "@/components/booking/DriverMatchingCard";

export const Route = createFileRoute("/_authenticated/searching")({
  head: () => ({ meta: [{ title: "Finding your driver — MiniPort" }] }),
  component: SearchingPage,
});

function SearchingPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const bookingId = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search).get("bookingId") ?? "";

  const booking = useQuery({
    queryKey: ["searching-booking", bookingId],
    enabled: !!user && !!bookingId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select(BOOKING_FIELDS)
        .eq("id", bookingId)
        .eq("customer_id", user!.id)
        .single();
      if (error) throw error;
      return data;
    },
    refetchInterval: 3000,
  });

  const b = booking.data;
  const accepted = !!b && ["accepted", "in_progress", "arrived", "completed"].includes(b.status);
  const closed = !!b && ["cancelled", "expired"].includes(b.status);

  return (
    <main className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-[#fff8f0] text-secondary">
      <header className="flex items-center gap-3 border-b bg-[#fff8f0] px-4 py-3">
        <Button variant="ghost" size="icon" aria-label="Back to booking" onClick={() => navigate({ to: "/customer" })}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-white"><Truck className="h-5 w-5" /></div>
        <div><p className="font-display text-xl">MiniPort</p><p className="text-xs text-muted-foreground">Ride tracking</p></div>
      </header>

      <section className="relative mx-4 mt-4 min-h-[260px] overflow-hidden rounded-3xl border bg-[#f1eee7] shadow-sm">
        <iframe
          title="Pickup area map"
          className="absolute inset-0 h-full w-full border-0 opacity-80"
          src="https://www.openstreetmap.org/export/embed.html?bbox=77.20%2C28.30%2C77.43%2C28.48&layer=mapnik"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-white/10 via-transparent to-white/70" />
        <div className="absolute left-1/2 top-1/2 grid h-32 w-32 -translate-x-1/2 -translate-y-1/2 place-items-center">
          <span className="absolute h-28 w-28 animate-ping rounded-full border-2 border-primary/50" />
          <span className="absolute h-20 w-20 rounded-full border border-primary/70 bg-primary/10" />
          <span className="relative grid h-14 w-14 place-items-center rounded-2xl bg-primary text-white shadow-xl"><Truck className="h-7 w-7" /></span>
        </div>
        <div className="absolute bottom-3 left-3 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold shadow">
          <MapPin className="mr-1 inline h-3.5 w-3.5 text-primary" /> Pickup area
        </div>
      </section>

      <section className="mx-4 mt-4 rounded-3xl border bg-white p-5 shadow-sm">
        {booking.isLoading ? (
          <div className="flex items-center gap-3"><Loader2 className="h-6 w-6 animate-spin text-primary" /><div><h1 className="text-xl font-bold">Finding your driver…</h1><p className="mt-1 text-sm text-muted-foreground">Connecting to the MiniPort logistics network.</p></div></div>
        ) : booking.isError || !b ? (
          <div><h1 className="text-xl font-bold">Couldn’t load this ride</h1><p className="mt-1 text-sm text-muted-foreground">Your booking is not deleted. Open My Rides to check its status.</p><Button className="mt-4" onClick={() => navigate({ to: "/orders" })}>Open My Rides</Button></div>
        ) : accepted ? (
          <div className="flex items-center gap-3"><CheckCircle2 className="h-8 w-8 text-emerald-600" /><div><h1 className="text-xl font-bold">Driver found!</h1><p className="text-sm text-muted-foreground">Your driver accepted the booking. Live trip details are available in My Rides.</p></div></div>
        ) : closed ? (
          <div><h1 className="text-xl font-bold">This booking is {b.status}</h1><p className="mt-1 text-sm text-muted-foreground">You can return to booking and create another ride.</p><Button className="mt-4" onClick={() => navigate({ to: "/customer" })}>Book another ride</Button></div>
        ) : (
          <div className="flex items-start gap-3"><Loader2 className="mt-1 h-6 w-6 animate-spin text-primary" /><div><h1 className="text-xl font-bold">Searching for nearby captains…</h1><p className="mt-1 text-sm text-muted-foreground">We’re checking nearby drivers and refreshing the ride status automatically.</p></div></div>
        )}
        {b && (
          <div className="mt-5 space-y-3 border-t pt-4">
            <div className="flex items-start gap-3"><MapPin className="mt-1 h-4 w-4 shrink-0 text-primary" /><div><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Pickup</p><p className="text-sm">{b.pickup_address}</p></div></div>
            <div className="flex items-start gap-3"><Package className="mt-1 h-4 w-4 shrink-0 text-primary" /><div><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Drop</p><p className="text-sm">{b.drop_address}</p></div></div>
            <div className="flex items-center justify-between rounded-xl bg-[#fff4e8] p-3"><span className="text-sm">{vehicleLabel(b.vehicle_type)}</span><span className="font-display text-2xl">₹{Number(b.final_fare || b.fare).toFixed(0)}</span></div>
            {!accepted && !closed && <DriverMatchingCard bookingId={b.id} vehicleType={vehicleLabel(b.vehicle_type)} currentFare={Number(b.final_fare || b.fare)} paymentStatus="pending" />}
            <div className="flex gap-2"><Button variant="outline" className="flex-1" onClick={() => navigate({ to: "/orders" })}>My Rides</Button><Button variant="ghost" className="flex-1" onClick={() => navigate({ to: "/customer" })}>New booking</Button></div>
            <p className="text-center text-[11px] text-muted-foreground">Ride status refreshes automatically · {STATUS_META[b.status]?.label ?? b.status}</p>
          </div>
        )}
      </section>
      <div className="h-6 shrink-0" />
    </main>
  );
}
