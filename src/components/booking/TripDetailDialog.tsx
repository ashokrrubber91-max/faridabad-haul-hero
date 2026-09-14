import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import type { AnyRow } from "@/lib/rows";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { vehicleLabel, STATUS_META } from "@/lib/booking";
import { supabase } from "@/integrations/supabase/client";
import { cancellationSummary } from "@/lib/cancellation";

type Booking = {
  id: string;
  created_at: string;
  status: string;
  pickup_address: string;
  drop_address: string;
  vehicle_type: string;
  distance_km: number | string;
  fare: number | string;
  coupon_code?: string | null;
  coupon_discount?: number | string | null;
  coins_redeemed?: number | string | null;
  payment_method?: string | null;
  payment_status?: string | null;
  cancellation_reason?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  cancellation_category?: string | null;

  pickup_verified_at?: string | null;
  drop_verified_at?: string | null;
  loading_started_at?: string | null;
  loading_stopped_at?: string | null;
  unloading_started_at?: string | null;
  unloading_stopped_at?: string | null;
  notes?: string | null;
  rating?: number | null;
};
const PAYMENT_LABEL: Record<string, string> = {
  cod: "Cash on delivery",
  wallet: "MiniPort wallet",
  upi: "UPI",
  card: "Card",
  netbanking: "Net banking",
};
const PAY_STATE: Record<string, { label: string; tone: string }> = {
  pending: { label: "Payment pending", tone: "bg-warning text-warning-foreground" },
  paid: { label: "Paid", tone: "bg-success text-success-foreground" },
  failed: { label: "Payment failed", tone: "bg-destructive text-destructive-foreground" },
  refunded: { label: "Refunded", tone: "bg-secondary text-secondary-foreground" },
};
function minutesBetween(a?: string | null, b?: string | null) {
  if (!a) return null;
  const end = b ? new Date(b).getTime() : Date.now();
  return Math.max(0, Math.round((end - new Date(a).getTime()) / 60000));
}
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-secondary">{value}</span>
    </div>
  );
}

export function TripDetailDialog({
  booking,
  onClose,
}: {
  booking: Booking | null;
  onClose: () => void;
}) {
  const [switchingCash, setSwitchingCash] = useState(false);
  const extraStops = useQuery({
    queryKey: ["booking-stops", booking?.id],
    enabled: !!booking?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("booking_stops")
        .select("id, address, sequence")
        .eq("booking_id", booking!.id)
        .eq("kind", "stop")
        .order("sequence");
      if (error) throw error;
      return data ?? [];
    },
  });
  if (!booking) return null;
  const b = booking;
  const meta = STATUS_META[b.status] ?? STATUS_META.pending;
  const pay = PAY_STATE[b.payment_status ?? "pending"] ?? PAY_STATE.pending;
  const discount = Number(b.coupon_discount ?? 0),
    coins = Number(b.coins_redeemed ?? 0),
    fare = Number(b.fare ?? 0),
    gross = fare + discount + coins;
  const loadMins = minutesBetween(b.loading_started_at, b.loading_stopped_at),
    unloadMins = minutesBetween(b.unloading_started_at, b.unloading_stopped_at);
  const closure = cancellationSummary(b);
  const switchToCash = async () => {
    setSwitchingCash(true);
    const { error } = await supabase.rpc("switch_failed_payment_to_cod", { _booking_id: b.id });
    setSwitchingCash(false);
    if (error) return toast.error(error.message);
    toast.success("Payment switched to cash. Your same booking is still active.");
    onClose();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Trip CRN {b.id.slice(0, 8).toUpperCase()}</DialogTitle>
          <DialogDescription>
            {new Date(b.created_at).toLocaleString("en-IN", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Badge className={meta.tone === "destructive" ? "bg-destructive" : undefined}>
            {meta.label}
          </Badge>
          <Badge className={pay.tone}>{pay.label}</Badge>
        </div>
        <div className="mt-2 rounded-md bg-muted/40 p-3 text-sm">
          <p className="font-medium text-secondary">{b.pickup_address}</p>
          {(extraStops.data ?? []).map((s) => (
            <p key={s.id} className="mt-1 text-muted-foreground">
              via {s.address}
            </p>
          ))}
          <p className="mt-1 text-muted-foreground">to {b.drop_address}</p>
        </div>
        <div className="divide-y divide-border">
          <Row label="Vehicle" value={vehicleLabel(b.vehicle_type as never)} />
          <Row label="Distance" value={`${Number(b.distance_km).toFixed(1)} km`} />
          <Row label="Trip charge" value={`₹${gross.toFixed(0)}`} />
          {discount > 0 && (
            <Row
              label={`Coupon ${b.coupon_code ?? ""}`.trim()}
              value={<span className="text-success">−₹{discount.toFixed(0)}</span>}
            />
          )}
          {coins > 0 && (
            <Row
              label="Coins redeemed"
              value={<span className="text-success">−₹{coins.toFixed(0)}</span>}
            />
          )}
          {Number((b as Record<string, unknown>).overtime_charge ?? 0) > 0 && (
            <Row
              label={`Waiting charge (${Number((b as Record<string, unknown>).loading_overtime_minutes ?? 0) + Number((b as Record<string, unknown>).unloading_overtime_minutes ?? 0)} min beyond free loading/unloading time)`}
              value={`₹${Number((b as Record<string, unknown>).overtime_charge ?? 0).toFixed(0)}`}
            />
          )}
          <Row label="Amount payable" value={`₹${fare.toFixed(0)}`} />
          <Row label="Payment method" value={PAYMENT_LABEL[b.payment_method ?? "cod"] ?? "—"} />
          {b.pickup_verified_at && (
            <Row
              label="Picked up"
              value={new Date(b.pickup_verified_at).toLocaleTimeString("en-IN", {
                timeStyle: "short",
              })}
            />
          )}
          {b.drop_verified_at && (
            <Row
              label="Delivered"
              value={new Date(b.drop_verified_at).toLocaleTimeString("en-IN", {
                timeStyle: "short",
              })}
            />
          )}
          {loadMins !== null && <Row label="Loading time" value={`${loadMins} min`} />}
          {unloadMins !== null && <Row label="Unloading time" value={`${unloadMins} min`} />}
          {b.rating ? <Row label="Your rating" value={"★".repeat(b.rating)} /> : null}
          {b.notes ? <Row label="Your note" value={b.notes} /> : null}
        </div>
        {b.payment_status === "failed" && b.status === "pending" && (
          <div className="rounded-md border border-warning bg-warning/10 p-3">
            <p className="text-sm font-semibold text-secondary">
              Online payment failed — your booking is not cancelled.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              You can keep this same booking and switch it to cash instead of creating another
              booking.
            </p>
            <Button
              className="mt-3 w-full"
              onClick={() => void switchToCash()}
              disabled={switchingCash}
            >
              {switchingCash ? "Switching…" : "Switch this booking to Cash"}
            </Button>
          </div>
        )}
        {closure && !closure.isPaymentFailure && (
          <div className="rounded-md border border-destructive bg-destructive/5 p-3 text-sm">
            <p className="font-semibold text-destructive">{closure.title}</p>
            {closure.who && closure.who !== closure.title && (
              <p className="text-xs text-muted-foreground">{closure.who}</p>
            )}
            <p className="text-muted-foreground">{closure.reason ?? "No reason recorded."}</p>
            {b.payment_status === "paid" && (
              <p className="mt-1 text-xs text-muted-foreground">
                Paid online — a refund is processed to your original payment method within 5–7
                working days. Contact support if it has been longer.
              </p>
            )}
            {b.payment_status === "refunded" && (
              <p className="mt-1 text-xs text-success">Refund has been processed.</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
