import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, MapPin, ShieldAlert, Truck } from "lucide-react";
import { getSharedTrip } from "@/lib/share.functions";
import { STATUS_META } from "@/lib/booking";
import { addressLines } from "@/lib/address";
import { isStaleFix } from "@/lib/geolocation";

export const Route = createFileRoute("/trip/$token")({
  head: () => ({
    meta: [
      { title: "Live trip status — MiniPort" },
      {
        name: "description",
        content:
          "Follow a shared MiniPort mini-truck delivery in Faridabad: live status, pickup and drop, vehicle and driver details.",
      },
      { property: "og:title", content: "Live trip status — MiniPort" },
      {
        property: "og:description",
        content:
          "Follow a shared MiniPort delivery: live status, pickup, drop and vehicle details.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SharedTripPage,
});

const REASON_COPY: Record<string, string> = {
  not_found: "This trip link is not valid. Ask the sender to share a new link.",
  revoked: "The sender has stopped sharing this trip.",
  expired: "This trip link has expired. Ask the sender for a fresh link.",
};

function SharedTripPage() {
  const { token } = Route.useParams();
  const fetchTrip = useServerFn(getSharedTrip);
  const trip = useQuery({
    queryKey: ["shared-trip", token],
    refetchInterval: 20_000,
    queryFn: () => fetchTrip({ data: { token } }),
  });

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <header className="mb-5">
        <p className="font-display text-2xl tracking-wide text-secondary">MiniPort</p>
        <h1 className="text-sm text-muted-foreground">Shared live trip</h1>
      </header>

      {trip.isLoading ? (
        <div className="surface-card p-6 text-sm text-muted-foreground">Loading trip status…</div>
      ) : trip.isError ? (
        <div className="surface-card p-6 text-sm text-muted-foreground">
          We could not load this trip right now. Please refresh in a moment.
        </div>
      ) : !trip.data?.ok ? (
        <div className="surface-card p-6 text-sm text-muted-foreground">
          <ShieldAlert className="mb-2 h-5 w-5 text-destructive" />
          {REASON_COPY[trip.data?.reason ?? "not_found"]}
        </div>
      ) : (
        <TripView trip={trip.data} />
      )}

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Shared links show trip status only — no phone numbers, delivery codes or payment details.{" "}
        <Link to="/" className="underline">
          About MiniPort
        </Link>
      </p>
    </main>
  );
}

function TripView({
  trip,
}: {
  trip: Extract<Awaited<ReturnType<typeof getSharedTrip>>, { ok: true }>;
}) {
  const meta = STATUS_META[trip.status] ?? STATUS_META.pending;
  const pickup = addressLines(trip.pickup_address, trip.pickup.lat, trip.pickup.lng);
  const drop = addressLines(trip.drop_address, trip.drop.lat, trip.drop.lng);
  const stale = trip.driver_location ? isStaleFix(trip.driver_location.updated_at) : true;

  return (
    <div className="surface-card space-y-4 p-5">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Status</p>
        <p className="font-display text-xl text-secondary">{meta.label}</p>
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pickup</p>
            <p className="text-sm text-secondary">{pickup.primary}</p>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Drop</p>
            <p className="text-sm text-secondary">{drop.primary}</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
        <Truck className="h-4 w-4 text-primary" />
        <span className="text-secondary">{trip.vehicle_label ?? "Goods vehicle"}</span>
        {trip.vehicle_number && (
          <span className="text-muted-foreground">· {trip.vehicle_number}</span>
        )}
        {trip.driver_first_name && (
          <span className="ml-auto text-muted-foreground">Driver {trip.driver_first_name}</span>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {Number(trip.distance_km).toFixed(1)} km trip ·{" "}
        {trip.driver_location
          ? stale
            ? "Driver location was last updated a while ago"
            : `Driver location updated ${new Date(trip.driver_location.updated_at).toLocaleTimeString("en-IN", { timeStyle: "short" })}`
          : "Live driver location is not being shared right now"}
      </p>
    </div>
  );
}
