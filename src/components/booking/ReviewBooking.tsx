import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Coins,
  MapPin,
  Package,
  Pencil,
  ReceiptText,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GoodsChecklist } from "@/components/booking/GoodsChecklist";
import { vehicleLabel, type VehicleId } from "@/lib/booking";
import type { PlacePick } from "@/components/booking/LocationSearchOverlay";
import type { CustomerGstin } from "@/components/booking/GstinSelect";
import { useVehicleMap, vehicleSpecs } from "@/lib/vehicles";

export function ReviewBooking({
  pickup,
  drop,
  stops,
  vehicle,
  distanceKm,
  baseFare,
  helperCount,
  helperFee,
  discount,
  fare,
  notes,
  gstin,
  scheduledAt,
  onScheduledAtChange,
  paymentMode,
  onPaymentModeChange,
  onBack,
  onEditPickup,
  onEditDrop,
  onConfirm,
  submitting,
}: {
  pickup: PlacePick;
  drop: PlacePick;
  stops: PlacePick[];
  vehicle: VehicleId;
  distanceKm: number;
  baseFare: number;
  helperCount: number;
  helperFee: number;
  discount: number;
  fare: number;
  notes: string;
  gstin: CustomerGstin | null;
  scheduledAt: string;
  onScheduledAtChange: (value: string) => void;
  paymentMode: "cash" | "wallet" | "upi";
  onPaymentModeChange: (mode: "cash" | "wallet" | "upi") => void;
  onBack: () => void;
  onEditPickup?: () => void;
  onEditDrop?: () => void;
  onConfirm: () => void;
  submitting: boolean;
}) {
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [coinsEnabled, setCoinsEnabled] = useState(discount > 0);
  const [breakupOpen, setBreakupOpen] = useState(false);
  const { map } = useVehicleMap();
  const specs = map.has(vehicle) ? vehicleSpecs(map.get(vehicle)!) : [];
  const extraStopFee = stops.length * 50;

  return (
    <div className="surface-card p-5">
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="icon" onClick={onBack} className="h-8 w-8">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="font-display text-2xl tracking-wide text-secondary">Review booking</h2>
      </div>

      <div className="mt-4 space-y-3">
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="flex items-start justify-between gap-2">
            <Stop label="Pickup" address={pickup.address} dotClass="text-primary" />
            <Button type="button" size="sm" variant="ghost" onClick={onEditPickup ?? onBack}>
              <Pencil className="h-3.5 w-3.5" /> Edit on map
            </Button>
          </div>
          {stops.map((s, i) => (
            <Stop key={i} label={"Stop " + (i + 1)} address={s.address} dotClass="text-warning" />
          ))}
          <div className="flex items-start justify-between gap-2">
            <Stop label="Drop" address={drop.address} dotClass="text-success" last />
            <Button type="button" size="sm" variant="ghost" onClick={onEditDrop ?? onBack}>
              <Pencil className="h-3.5 w-3.5" /> Edit on map
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Vehicle</p>
            <p className="flex items-center gap-1 text-sm font-semibold text-secondary">
              <Truck className="h-4 w-4 text-primary" />
              {vehicleLabel(vehicle)}
            </p>
          </div>
          <Badge variant="secondary">{distanceKm} km</Badge>
        </div>

        {specs.length > 0 && (
          <div className="rounded-md border p-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Vehicle specifications
            </p>
            <dl className="mt-1 space-y-1 text-sm">
              {specs.map((s) => (
                <div key={s.label} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{s.label}</dt>
                  <dd className="text-right font-medium text-secondary">{s.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {notes.trim() && (
          <div className="rounded-md border p-3">
            <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
              <Package className="h-3.5 w-3.5" /> Notes for driver
            </p>
            <p className="mt-1 text-sm text-secondary">{notes}</p>
          </div>
        )}

        {gstin && (
          <div className="rounded-md border p-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Billed to (GSTIN)
            </p>
            <p className="text-sm font-semibold text-secondary">{gstin.business_name}</p>
            <p className="text-xs text-muted-foreground">{gstin.gstin}</p>
          </div>
        )}

        <div className="rounded-xl border p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-secondary">Loading-unloading service</p>
              <p className="mt-1 text-xs text-muted-foreground">Starts @ ₹7 per item</p>
            </div>
            <Badge variant="outline">{helperCount > 0 ? "Selected" : "Optional"}</Badge>
          </div>
          {helperCount > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {helperCount} helper{helperCount > 1 ? "s" : ""} · +₹{helperFee}
            </p>
          )}
        </div>

        <div
          className={
            "flex items-center justify-between rounded-xl border p-4 " +
            (coinsEnabled ? "border-primary bg-primary/5" : "")
          }
        >
          <div className="flex items-start gap-2">
            <Coins className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-bold text-secondary">Offers &amp; Coins</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {discount > 0
                  ? "Use MiniPort Coins to save ₹" + discount
                  : "Use MiniPort Coins to save ₹X"}
              </p>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant={coinsEnabled ? "default" : "outline"}
            onClick={() => setCoinsEnabled((v) => !v)}
          >
            {coinsEnabled ? "ON" : "OFF"}
          </Button>
        </div>

        <div className="rounded-xl border p-4">
          <p className="text-sm font-bold text-secondary">Pickup schedule</p>
          <p className="mt-1 text-xs text-muted-foreground">Leave blank for the earliest available driver, or choose a future pickup time.</p>
          <input type="datetime-local" value={scheduledAt} min={new Date(Date.now() + 31 * 60_000).toISOString().slice(0, 16)} onChange={(e) => onScheduledAtChange(e.target.value)} className="mt-3 h-11 w-full rounded-md border border-input bg-background px-3 text-sm" />
          {scheduledAt && <p className="mt-2 text-xs font-medium text-primary">Driver alerts will be sent 30 minutes before pickup.</p>}
        </div>

        <div className="rounded-xl border p-4">
          <div className="flex items-center gap-2">
            <ReceiptText className="h-5 w-5 text-primary" />
            <p className="text-sm font-bold text-secondary">Payment</p>
          </div>
          <select
            value={paymentMode}
            onChange={(e) => onPaymentModeChange(e.target.value as "cash" | "wallet" | "upi")}
            className="mt-3 h-11 w-full rounded-lg border bg-background px-3 text-sm font-medium text-secondary outline-none focus:ring-2 focus:ring-primary"
            aria-label="Payment method"
          >
            <option value="cash">Cash</option>
            <option value="wallet">Wallet</option>
            <option value="upi">UPI</option>
          </select>
          <Button
            type="button"
            variant="outline"
            className="mt-2 w-full"
            onClick={() => setBreakupOpen(true)}
          >
            View Breakup
          </Button>
        </div>

        <div className="rounded-md border p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Base fare</span>
            <span>₹{baseFare}</span>
          </div>
          {helperCount > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                Helper{helperCount > 1 ? "s" : ""} ({helperCount})
              </span>
              <span>+ ₹{helperFee}</span>
            </div>
          )}
          {extraStopFee > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Extra stops ({stops.length})</span>
              <span>+ ₹{extraStopFee}</span>
            </div>
          )}
          {discount > 0 && (
            <div className="flex justify-between text-success">
              <span>Discount / coins</span>
              <span>− ₹{fare >= baseFare ? discount : 0}</span>
            </div>
          )}
          <div className="mt-1 flex justify-between border-t pt-1 font-display text-lg text-secondary">
            <span>Total payable</span>
            <span>₹{fare}</span>
          </div>
        </div>

        <Button\n          type="button"\n          variant="outline"\n          className="h-11 w-full border-green-500/40 text-green-700 hover:bg-green-500/10"\n          onClick={() =>\n            window.open(\n              `https://wa.me/?text=${encodeURIComponent("Hi MiniPort, I need a vehicle to send goods. Please help me book a vehicle.")}`,\n              "_blank",\n              "noopener,noreferrer",\n            )\n          }\n        >\n          <MessageCircle className="h-4 w-4" /> Book via WhatsApp\n        </Button>\n        <Button onClick={onConfirm} disabled={submitting} className="h-11 w-full">
          {submitting ? "Booking…" : "Confirm & book · ₹" + fare}{" "}
          {!submitting && <ArrowRight className="h-4 w-4" />}
        </Button>
        <button
          type="button"
          onClick={() => setChecklistOpen(true)}
          className="w-full text-center text-xs text-muted-foreground underline underline-offset-2"
        >
          What can&apos;t be carried? View goods restrictions
        </button>
      </div>

      <Dialog open={breakupOpen} onOpenChange={setBreakupOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fare breakup</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span>Base fare</span>
              <span>₹{baseFare}</span>
            </div>
            {helperCount > 0 && (
              <div className="flex justify-between">
                <span>Loading-unloading / helper</span>
                <span>+ ₹{helperFee}</span>
              </div>
            )}
            {extraStopFee > 0 && (
              <div className="flex justify-between">
                <span>Extra stops ({stops.length})</span>
                <span>+ ₹{extraStopFee}</span>
              </div>
            )}
            {discount > 0 && coinsEnabled && (
              <div className="flex justify-between text-success">
                <span>MiniPort Coins</span>
                <span>− ₹{discount}</span>
              </div>
            )}
            <div className="flex justify-between border-t pt-2 font-bold">
              <span>Total</span>
              <span>₹{fare}</span>
            </div>
            <div className="mt-3 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              Payment method:{" "}
              <span className="font-semibold text-secondary">{paymentMode.toUpperCase()}</span>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <GoodsChecklist open={checklistOpen} onOpenChange={setChecklistOpen} onConfirmed={() => {}} />
    </div>
  );
}

function Stop({
  label,
  address,
  dotClass,
  last,
}: {
  label: string;
  address: string;
  dotClass: string;
  last?: boolean;
}) {
  return (
    <div
      className={
        "flex min-w-0 items-start gap-2 " + (last ? "" : "border-b border-dashed pb-2 mb-2")
      }
    >
      <MapPin className={"mt-0.5 h-4 w-4 shrink-0 " + dotClass} />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="truncate text-sm text-secondary">{address}</p>
      </div>
    </div>
  );
}
