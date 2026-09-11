import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Download, Loader2, Package, RotateCcw, Star, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { STATUS_META, vehicleLabel } from "@/lib/booking";
import { buildInvoiceHtml, invoiceNumber, openInvoice } from "@/lib/invoice";

export const Route = createFileRoute("/_authenticated/orders")({
  head: () => ({
    meta: [
      { title: "My orders — MiniPort" },
      { name: "description", content: "Every MiniPort trip you have booked, with invoices, driver details and one-tap re-booking." },
      { property: "og:title", content: "My orders — MiniPort" },
      { property: "og:description", content: "Track past and active mini-truck bookings, download tax invoices and book again." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OrdersPage,
});

type Filter = "active" | "completed" | "cancelled";

function OrdersPage() {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("active");
  const [rateTarget, setRateTarget] = useState<{ id: string; addr: string } | null>(null);
  const [stars, setStars] = useState(5);
  const [review, setReview] = useState("");

  const twoYearsAgo = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 2);
    return d.toISOString();
  }, []);

  const orders = useQuery({
    queryKey: ["orders", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("customer_id", user!.id)
        .gte("created_at", twoYearsAgo)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const driverIds = useMemo(
    () => Array.from(new Set((orders.data ?? []).map((o) => o.driver_id).filter(Boolean))) as string[],
    [orders.data],
  );

  const drivers = useQuery({
    queryKey: ["order-drivers", driverIds.join(",")],
    enabled: driverIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, name, phone").in("id", driverIds);
      const map: Record<string, { name: string; phone: string }> = {};
      (data ?? []).forEach((d) => (map[d.id] = { name: d.name, phone: d.phone }));
      return map;
    },
  });

  const kycByDriver = useQuery({
    queryKey: ["order-driver-vehicles", driverIds.join(",")],
    enabled: driverIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("driver_kyc").select("driver_id, vehicle_number").in("driver_id", driverIds);
      const map: Record<string, string> = {};
      (data ?? []).forEach((d) => {
        if (d.vehicle_number) map[d.driver_id] = d.vehicle_number;
      });
      return map;
    },
  });

  const rate = useMutation({
    mutationFn: async ({ id, rating, text }: { id: string; rating: number; text: string }) => {
      const { error } = await supabase
        .from("bookings")
        .update({ rating, review: text.trim() || null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Thanks for rating your trip");
      setRateTarget(null);
      setReview("");
      setStars(5);
      qc.invalidateQueries({ queryKey: ["orders", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const all = orders.data ?? [];
  const list = all.filter((o) =>
    filter === "active"
      ? ["pending", "accepted", "in_progress"].includes(o.status)
      : filter === "completed"
        ? o.status === "completed"
        : o.status === "cancelled",
  );

  const downloadInvoice = (b: (typeof all)[number]) => {
    const ok = openInvoice(
      buildInvoiceHtml(
        b,
        { name: profile?.name ?? "Customer", phone: profile?.phone ?? "" },
        vehicleLabel(b.vehicle_type),
      ),
    );
    if (!ok) toast.error("Allow pop-ups to download the invoice");
  };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-3xl tracking-wide text-secondary">My rides</h1>
        <p className="text-sm text-muted-foreground">Every booking from the last 2 years.</p>
      </header>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
        </TabsList>
      </Tabs>

      {orders.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : list.length === 0 ? (
        <div className="surface-card p-8 text-center text-sm text-muted-foreground">
          <Package className="mx-auto mb-2 h-5 w-5" />
          No {filter} rides yet.
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((b) => {
            const meta = STATUS_META[b.status] ?? STATUS_META.pending;
            const driver = b.driver_id ? drivers.data?.[b.driver_id] : null;
            const vehicleNumber = b.driver_id ? kycByDriver.data?.[b.driver_id] : null;
            return (
              <article key={b.id} className="surface-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      CRN {b.id.slice(0, 8).toUpperCase()} · {new Date(b.created_at).toLocaleDateString("en-IN")}
                    </p>
                    <p className="mt-1 truncate text-sm font-medium text-secondary">{b.pickup_address}</p>
                    <p className="flex items-center gap-1 truncate text-sm text-muted-foreground">
                      <ArrowRight className="h-3 w-3 shrink-0" /> {b.drop_address}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {vehicleLabel(b.vehicle_type)} · {Number(b.distance_km).toFixed(1)} km
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-display text-xl text-secondary">₹{Number(b.fare).toFixed(0)}</p>
                    <Badge variant={meta.tone === "destructive" ? "destructive" : "secondary"} className={tone(meta.tone)}>
                      {meta.label}
                    </Badge>
                  </div>
                </div>

                {driver && (
                  <div className="mt-3 flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-secondary">
                    <Truck className="h-3.5 w-3.5 text-primary" />
                    <span className="font-semibold">{driver.name}</span>
                    {vehicleNumber && <span className="text-muted-foreground">· {vehicleNumber}</span>}
                    <a href={`tel:${driver.phone}`} className="ml-auto font-medium text-primary">
                      {driver.phone}
                    </a>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {b.status === "completed" && (
                    <Button size="sm" variant="outline" onClick={() => downloadInvoice(b)}>
                      <Download className="h-3.5 w-3.5" /> Invoice {invoiceNumber(b.id, b.created_at).split("/").pop()}
                    </Button>
                  )}
                  {b.status === "completed" && !b.rating && (
                    <Button size="sm" onClick={() => setRateTarget({ id: b.id, addr: b.drop_address })}>
                      <Star className="h-3.5 w-3.5" /> Rate trip
                    </Button>
                  )}
                  {b.rating ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-2 py-1 text-xs font-semibold text-warning-foreground">
                      {"★".repeat(b.rating)}
                      <span className="text-muted-foreground">{"★".repeat(5 - b.rating)}</span>
                    </span>
                  ) : null}
                  {(b.status === "completed" || b.status === "cancelled") && (
                    <Button size="sm" variant="ghost" asChild>
                      <a href={`/customer?again=${b.id}`}>
                        <RotateCcw className="h-3.5 w-3.5" /> Book again
                      </a>
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Dialog open={!!rateTarget} onOpenChange={(v) => !v && setRateTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>How was your trip?</DialogTitle>
            <DialogDescription className="truncate">{rateTarget?.addr}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" onClick={() => setStars(n)} aria-label={`${n} star`}>
                <Star
                  className={`h-8 w-8 ${n <= stars ? "fill-warning text-warning" : "text-muted-foreground"}`}
                />
              </button>
            ))}
          </div>
          <Textarea
            rows={3}
            maxLength={300}
            placeholder="Anything you'd like to share about the driver? (optional)"
            value={review}
            onChange={(e) => setReview(e.target.value)}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRateTarget(null)}>
              Later
            </Button>
            <Button
              disabled={rate.isPending}
              onClick={() => rateTarget && rate.mutate({ id: rateTarget.id, rating: stars, text: review })}
            >
              {rate.isPending ? "Saving…" : "Submit rating"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
    default:
      return "";
  }
}
