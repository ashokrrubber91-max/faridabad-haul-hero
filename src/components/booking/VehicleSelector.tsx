import { PackagePlus, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { VehicleCard } from "@/components/booking/VehicleCard";
import type { VehicleType } from "@/lib/vehicles";

export function VehicleSelector({
  vehicles,
  selectedId,
  onSelect,
  helperCount,
  onHelperCountChange,
  coins,
  maxCoins,
  coinValue,
  useCoins,
  onUseCoinsChange,
}: {
  vehicles: VehicleType[];
  selectedId: string;
  onSelect: (id: string) => void;
  helperCount: number;
  onHelperCountChange: (count: number) => void;
  coins: number;
  maxCoins: number;
  coinValue: number;
  useCoins: boolean;
  onUseCoinsChange: (enabled: boolean) => void;
}) {
  const selected = vehicles.find((v) => v.id === selectedId);
  const payload = selected?.payload_kg ?? selected?.weight_limit_kg ?? 0;
  const helperEligible = payload > 20;
  const coinSave = Math.min(Math.max(0, coinValue), Math.max(0, maxCoins));

  return (
    <div className="space-y-3">
      <Label>Vehicle</Label>
      <div className="flex flex-col gap-2">
        {vehicles.map((vehicle) => (
          <VehicleCard key={vehicle.id} vehicle={vehicle} selected={selectedId === vehicle.id} onSelect={() => onSelect(vehicle.id)} />
        ))}
      </div>

      {selected && (
        <div className="rounded-xl border bg-muted/20 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-secondary">
            <PackagePlus className="h-4 w-4 text-primary" /> Loading / unloading service
          </div>
          <p className="mt-1 text-xs text-muted-foreground">₹7 per item, or use a fixed helper charge where helpers are enabled.</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[0, 1, 2].map((count) => (
              <button
                key={count}
                type="button"
                disabled={!helperEligible && count > 0}
                onClick={() => onHelperCountChange(count)}
                className={"rounded-lg border px-2 py-3 text-center text-xs " + (helperCount === count ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted") + ((!helperEligible && count > 0) ? " cursor-not-allowed opacity-40" : "")}
              >
                <span className="block font-semibold">{count === 0 ? "No helper" : count + (count === 1 ? " helper" : " helpers")}</span>
                <span className="mt-1 block text-muted-foreground">{count === 0 ? "Free" : "Fixed helper charge"}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={"flex items-center justify-between rounded-xl border p-3 " + (useCoins ? "border-primary bg-primary/5" : "")}>
        <div className="flex items-start gap-2">
          <Coins className="mt-0.5 h-4 w-4 text-primary" />
          <div>
            <p className="text-sm font-semibold text-secondary">Use MiniPort Coins</p>
            <p className="text-xs text-muted-foreground">
              {coins > 0 ? "Save ₹" + coinSave + " on this booking" : "No coins available"}
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant={useCoins ? "default" : "outline"}
          disabled={coins <= 0}
          onClick={() => onUseCoinsChange(!useCoins)}
        >
          {useCoins ? "Applied" : "Use coins"}
        </Button>
      </div>
    </div>
  );
}
