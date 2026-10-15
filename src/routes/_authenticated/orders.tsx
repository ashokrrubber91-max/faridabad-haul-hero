import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowRight,
  Download,
  Loader2,
  Package,
  RotateCcw,
  ChevronRight,
  Search,
  Star,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { STATUS_META, vehicleLabel, BOOKING_FIELDS } from "@/lib/booking";
import { buildInvoiceHtml, openInvoice } from "@/lib/invoice";
import { TripDetailDialog } from "@/components/booking/TripDetailDialog";

export const Route = createFileRoute("/_authenticated/orders")({
  head: () => ({
    meta: [
      { title: "My orders — MiniPort" },
      {
        name: "description",
        content:
          "Every MiniPort trip you have booked, with invoices, driver details and one-tap re-booking.",
      },
      { property: "og:title", content: "My orders — MiniPort" },
      {
        property: "og:description",
        content: "Track past and active mini-truck bookings, download tax invoices and book again.",
      },
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
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(10);
  const [rateTarget, setRateTarget] = useState<{ id: string; addr: string } | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
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
      if (!user) return [];
      const { data, error } = await supabase
        .from("bookings")
        .select(BOOKING_FIELDS)
        .eq("customer_id", user.id)
        .gte("created_at", twoYearsAgo)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) {
        console.error("[MiniPort] Orders history query failed", {
          code: error.code,
          message: error.message,
          hint: error.hint,
          details: error.details,
        });
        throw error;
      }
      return data ?? [];
    },
    staleTime: 15_000,
    refetchInterval: (query) =>
      query.state.data?.some((o) => ["pending", "accepted", "in_progress"].includes(o.status))
        ? 15_000
        : false,
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
  const term = search.trim().toLowerCase();
  const list = all
    .filter((o) =>
      filter === "active"
        ? ["pending", "scheduled", "accepted", "arrived", "in_progress"].includes(o.status)
        : filter === "completed"
          ? o.status === "completed"
          : o.status === "cancelled" || o.status === "expired",
    )
    .filter((o) =>
      term
        ? o.pickup_address.toLowerCase().includes(term) ||
          o.drop_address.toLowerCase().includes(term) ||
          o.id.slice(0, 8).toLowerCase().includes(term)
        : true,
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
      </header>

      <Tabs
        value={filter}
        onValueChange={(v) => {
          setFilter(v as Filter);
          setShown(10);
        }}
      >
        <TabsList className="grid h-12 w-full grid-cols-3 rounded-lg">
          <TabsTrigger value="active">Active Rides</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setShown(10);
          }}
          placeholder="Search by pickup, drop or ride number"
          aria-label="Search your rides"
          className="h-7 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
        />
        {search && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSearch("")}
            aria-label="Clear search"
            className="text-xs font-medium text-primary"
          >
            Clear
          </Button>
        )}
      </div>

      {orders.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : orders.isError ? (
        <div className="surface-card p-8 text-center text-sm">
          <Package className="mx-auto mb-2 h-5 w-5 text-destructive" />
          <p className="text-muted-foreground">
            We couldn&apos;t load your rides. Check your connection and try again.
          </p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => orders.refetch()}>
            Retry
          </Button>
        </div>
      ) : list.length === 0 ? (
        <div className="surface-card p-8 text-center text-sm text-muted-foreground">
          <Package className="mx-auto mb-2 h-5 w-5" />
          {search.trim()
            ? `No ${filter} rides match “${search.trim()}”.`
            : `No ${filter} rides yet.`}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.slice(0, shown).map((b) => {
            const meta = STATUS_META[b.status] ?? STATUS_META.pending;
            return (
              <article key={b.id} className="overflow-hidden rounded-lg border bg-card">
                <Button
                  variant="ghost"
                  className="h-auto w-full flex-col items-stretch gap-3 rounded-none p-4 text-left font-normal"
                  onClick={() => setDetail(b.id)}
                  aria-label={`Open ${vehicleLabel(b.vehicle_type)} ride ${b.id.slice(0, 8)}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <Truck className="h-5 w-5 shrink-0 text-primary" />
                      <span className="truncate font-semibold">{vehicleLabel(b.vehicle_type)}</span>
                    </div>
                    <Badge
                      variant={meta.tone === "destructive" ? "destructive" : "secondary"}
                      className={tone(meta.tone)}
                    >
                      {meta.label}
                    </Badge>
                  </div>
                  <div className="w-full min-w-0 space-y-1 text-sm">
                    <p className="truncate">{b.pickup_address}</p>
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <ArrowRight className="h-3 w-3 shrink-0" />
                      <span className="truncate">{b.drop_address}</span>
                    </p>
                  </div>
                  {b.scheduled_for && (
                    <p className="whitespace-normal text-xs text-primary">
                      Scheduled for{" "}
                      {new Date(b.scheduled_for).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                  )}
                  <div className="flex w-full items-center justify-between border-t pt-3">
                    <span className="text-xs text-muted-foreground">
                      {new Date(b.created_at).toLocaleDateString("en-IN")} ·{" "}
                      {Number(b.distance_km).toFixed(1)} km
                    </span>
                    <span className="flex items-center gap-2 text-lg font-bold">
                      ₹{Number(b.final_fare ?? b.fare).toFixed(0)}
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </span>
                  </div>
                </Button>
              </article>
            );
          })}
          {list.length > shown && (
            <Button
              variant="outline"
              className="w-full md:col-span-2"
              onClick={() => setShown((n) => n + 10)}
            >
              Show older rides ({list.length - shown} more)
            </Button>
          )}
        </div>
      )}

      <TripDetailDialog
        booking={all.find((o) => o.id === detail) ?? null}
        onClose={() => setDetail(null)}
        actions={(() => {
          const b = all.find((o) => o.id === detail);
          if (!b) return null;
          return (
            <div className="flex flex-wrap gap-2">
              {["pending", "scheduled", "accepted", "in_progress"].includes(b.status) && (
                <Button asChild>
                  <Link to="/searching" search={{ bookingId: b.id }}>
                    Track ride <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              )}
              {b.status === "completed" && (
                <Button size="sm" variant="outline" onClick={() => downloadInvoice(b)}>
                  <Download className="h-4 w-4" />
                  Invoice
                </Button>
              )}
              {b.status === "completed" && !b.rating && (
                <Button
                  size="sm"
                  onClick={() => {
                    setDetail(null);
                    setRateTarget({ id: b.id, addr: b.drop_address });
                  }}
                >
                  <Star className="h-4 w-4" />
                  Rate trip
                </Button>
              )}
              {["completed", "cancelled", "expired"].includes(b.status) && (
                <Button variant="outline" size="sm" asChild>
                  <Link to="/customer" search={{ again: b.id }}>
                    <RotateCcw className="h-4 w-4" />
                    Book again
                  </Link>
                </Button>
              )}
            </div>
          );
        })()}
      />

      <Dialog open={!!rateTarget} onOpenChange={(v) => !v && setRateTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>How was your trip?</DialogTitle>
            <DialogDescription className="truncate">{rateTarget?.addr}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <Button
                key={n}
                variant="ghost"
                size="icon"
                onClick={() => setStars(n)}
                aria-label={`${n} star`}
              >
                <Star
                  className={`h-8 w-8 ${n <= stars ? "fill-warning text-warning" : "text-muted-foreground"}`}
                />
              </Button>
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
              onClick={() =>
                rateTarget && rate.mutate({ id: rateTarget.id, rating: stars, text: review })
              }
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
