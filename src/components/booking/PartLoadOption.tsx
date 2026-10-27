import { Users } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { remainingLoadCapacity, sharedLoadFare } from "@/lib/co-loading";

/** Kept unavailable until isolated-backend atomic pooling and settlement are installed. */
export function PartLoadOption({
  weight,
  onWeightChange,
  capacity,
  standardFare,
}: {
  weight: string;
  onWeightChange: (value: string) => void;
  capacity: number;
  standardFare: number;
}) {
  const remaining = remainingLoadCapacity(Number(weight), capacity);
  return (
    <section className="space-y-3 border-y py-4">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="part-load-cargo-weight">Cargo weight (kg)</Label>
        <span className="text-xs text-muted-foreground">
          {capacity > 0 ? `${capacity} kg capacity` : "Capacity unavailable"}
        </span>
      </div>
      <Input
        id="part-load-cargo-weight"
        type="number"
        inputMode="decimal"
        min={0.1}
        step={0.1}
        max={capacity || 50000}
        value={weight}
        onChange={(event) => onWeightChange(event.target.value)}
        placeholder="e.g. 600"
      />
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Users className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <Label htmlFor="part-load-sharing">Share Ride / Part-Load</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              {remaining === null
                ? "Requires goods below vehicle capacity"
                : `${remaining} kg available for another load`}
            </p>
          </div>
        </div>
        <Switch
          id="part-load-sharing"
          checked={false}
          disabled
          aria-label="Share Ride / Part-Load"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Shared matching is not available in this testing setup. Standard-fare booking remains
        available.
      </p>
      {remaining !== null && standardFare > 0 && (
        <div className="flex flex-wrap justify-between gap-2 text-xs">
          <span>Matched fare: ₹{sharedLoadFare(standardFare, true)} · 25% off</span>
          <span>No match: ₹{sharedLoadFare(standardFare, false)}</span>
        </div>
      )}
    </section>
  );
}
