import { useState } from "react";
import { ArrowLeft, ArrowRight, MapPin, Package, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { VEHICLES, vehicleLabel, type VehicleId } from "@/lib/booking";
import type { PlacePick } from "@/components/booking/LocationSearchOverlay";
import type { CustomerGstin } from "@/components/booking/GstinSelect";
import { GoodsChecklist } from "@/components/booking/GoodsChecklist";


export function ReviewBooking({
  pickup,
  drop,
  stops,
  vehicle,
  distanceKm,
  baseFare,
  discount,
  fare,
  notes,
  gstin,
  onBack,
  onConfirm,
  submitting,
}: {
  pickup: PlacePick;
  drop: PlacePick;
  stops: PlacePick[];
  vehicle: VehicleId;
  distanceKm: number;
  baseFare: number;
  discount: number;
  fare: number;
  notes: string;
  gstin: CustomerGstin | null;
  onBack: () => void;
  onConfirm: () => void;
  submitting: boolean;
}) {
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [checklistDone, setChecklistDone] = useState(false);
  const v = VEHICLES.find((x) => x.id === vehicle);

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
          <Stop label="Pickup" address={pickup.address} dotClass="text-primary" />
          {stops.map((s, i) => (
            <Stop key={i} label={`Stop ${i + 1}`} address={s.address} dotClass="text-warning" />
          ))}
          <Stop label="Drop" address={drop.address} dotClass="text-success" last />
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Vehicle</p>
            <p className="text-sm font-semibold text-secondary">{v?.label ?? vehicleLabel(vehicle)}</p>
          </div>
          <Badge variant="secondary">{distanceKm} km</Badge>
        </div>

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
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Billed to (GSTIN)</p>
            <p className="text-sm font-semibold text-secondary">{gstin.business_name}</p>
            <p className="text-xs text-muted-foreground">{gstin.gstin}</p>
          </div>
        )}

        <div className="rounded-md border p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Base fare</span>
            <span>₹{baseFare}</span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between text-success">
              <span>Discount / coins</span>
              <span>− ₹{discount}</span>
            </div>
          )}
          <div className="mt-1 flex justify-between border-t pt-1 font-display text-lg text-secondary">
            <span>Total payable</span>
            <span>₹{fare}</span>
          </div>
        </div>

        <label className="flex items-center justify-between rounded-md border p-3 text-sm">
          <span className="text-secondary">Goods restrictions confirmed</span>
          <Button
            type="button"
            size="sm"
            variant={checklistDone ? "secondary" : "outline"}
            onClick={() => setChecklistOpen(true)}
          >
            {checklistDone ? "Confirmed ✓" : "Confirm now"}
          </Button>
        </label>

        <Button
          onClick={onConfirm}
          disabled={!checklistDone || submitting}
          className="h-11 w-full"
        >
          {submitting ? "Booking…" : `Confirm & book · ₹${fare}`}
          {!submitting && <ArrowRight className="h-4 w-4" />}
        </Button>
      </div>

      <GoodsChecklist
        open={checklistOpen}
        onOpenChange={setChecklistOpen}
        onConfirmed={() => setChecklistDone(true)}
      />
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
    <div className={`flex items-start gap-2 ${last ? "" : "border-b border-dashed pb-2 mb-2"}`}>
      <MapPin className={`mt-0.5 h-4 w-4 shrink-0 ${dotClass}`} />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="truncate text-sm text-secondary">{address}</p>
      </div>
    </div>
  );
}
