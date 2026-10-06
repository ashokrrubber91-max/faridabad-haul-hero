import { useState } from "react";
import { CarFront, ChevronRight, Loader2, Plus, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const BOOSTS = [5, 25, 35, 45];

export function DriverMatchingCard({
  vehicleType,
  attempted = 0,
  total = 5,
  elapsedSeconds = 0,
  alternatives = ["Pickup 8ft", "Tata 407"],
  onBoost,
  onAlternative,
}: {
  vehicleType: string;
  attempted?: number;
  total?: number;
  elapsedSeconds?: number;
  alternatives?: string[];
  onBoost?: (amount: number) => void;
  onAlternative?: (vehicle: string) => void;
}) {
  const [boost, setBoost] = useState<number | null>(null);
  const progress = Math.min(100, Math.round((attempted / Math.max(total, 1)) * 100));
  const showAlternatives = elapsedSeconds >= 60;

  const chooseBoost = (amount: number) => {
    setBoost(amount);
    onBoost?.(amount);
  };

  return (
    <div className="mt-3 rounded-xl border bg-background p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-secondary">Finding a captain for {vehicleType}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {attempted} of {total} captains didn't accept your ride
          </p>
        </div>
        <Badge variant="outline">{Math.round((total - attempted) / Math.max(total, 1) * 100)}% search</Badge>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: progress + "%" }} />
      </div>

      <div className="mt-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-secondary">
          <TrendingUp className="h-4 w-4 text-primary" /> Boost fare to get accepted faster
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {BOOSTS.map((amount) => (
            <Button
              key={amount}
              type="button"
              size="sm"
              variant={boost === amount ? "default" : "outline"}
              onClick={() => chooseBoost(amount)}
            >
              +₹{amount}
            </Button>
          ))}
        </div>
        {boost !== null && (
          <p className="mt-2 text-[11px] text-success">₹{boost} boost selected for this driver search.</p>
        )}
      </div>

      {showAlternatives && alternatives.length > 0 && (
        <div className="mt-4 rounded-lg bg-muted/40 p-3">
          <p className="text-xs font-semibold text-secondary">Search is taking longer than 60 seconds</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Try another nearby vehicle category.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {alternatives.map((vehicle) => (
              <Button key={vehicle} type="button" size="sm" variant="outline" onClick={() => onAlternative?.(vehicle)}>
                <Plus className="mr-1 h-3 w-3" /> ADD {vehicle}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
