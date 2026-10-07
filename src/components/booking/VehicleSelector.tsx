import { Coins, Info, PackagePlus, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useVehicleImage } from "@/components/booking/VehicleCard";
import type { VehicleType } from "@/lib/vehicles";

export function VehicleSelector({
  vehicles,
  selectedId,
  onSelect,
  onProceed,
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
  onProceed?: (id: string) => void;
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
          <VehicleOption
            key={vehicle.id}
            vehicle={vehicle}
            selected={selectedId === vehicle.id}
            onSelect={() => onSelect(vehicle.id)}
          />
        ))}
      </div>

      {selected && (
        <div className="rounded-2xl border bg-muted/20 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-secondary">
            <PackagePlus className="h-4 w-4 text-primary" /> Loading / unloading service
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Starts @ ₹7 per item.</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[0, 1, 2].map((count) => (
              <button
                key={count}
                type="button"
                disabled={!helperEligible && count > 0}
                onClick={() => onHelperCountChange(count)}
                className={
                  "rounded-lg border px-2 py-3 text-center text-xs " +
                  (helperCount === count
                    ? "border-primary bg-primary/10 text-primary"
                    : "hover:bg-muted") +
                  (!helperEligible && count > 0 ? " cursor-not-allowed opacity-40" : "")
                }
              >
                <span className="block font-semibold">
                  {count === 0 ? "No helper" : count + (count === 1 ? " helper" : " helpers")}
                </span>
                <span className="mt-1 block text-muted-foreground">
                  {count === 0 ? "Free" : "Fixed helper charge"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        className={
          "flex items-center justify-between rounded-xl border p-3 " +
          (useCoins ? "border-primary bg-primary/5" : "")
        }
      >
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

      {selected && (
        <div className="sticky bottom-2 z-20 pt-1">
          <Button
            type="button"
            className="h-12 w-full rounded-xl text-base font-bold shadow-lg"
            onClick={() => (onProceed ? onProceed(selected.id) : onSelect(selected.id))}
          >
            <Zap className="h-4 w-4 fill-current" /> Proceed with {selected.label}
          </Button>
        </div>
      )}
    </div>
  );
}

function VehicleOption({
  vehicle,
  selected,
  onSelect,
}: {
  vehicle: VehicleType;
  selected: boolean;
  onSelect: () => void;
}) {
  const img = useVehicleImage(vehicle);
  const payload = vehicle.payload_kg ?? vehicle.weight_limit_kg;
  const dimensions =
    vehicle.length_ft && vehicle.width_ft
      ? String(vehicle.length_ft) +
        " × " +
        String(vehicle.width_ft) +
        (vehicle.height_ft ? " × " + String(vehicle.height_ft) : "") +
        " FT"
      : null;

  if (selected) {
    return (
      <button
        type="button"
        onClick={onSelect}
        aria-pressed="true"
        className="w-full rounded-2xl border-2 border-blue-600 bg-blue-50/20 p-4 text-left shadow-md ring-1 ring-blue-600/20"
      >
        <div className="space-y-3">
          <div className="relative flex min-h-32 items-center justify-center overflow-hidden rounded-xl bg-blue-50/50 py-2">
            {dimensions && (
              <div className="absolute top-2 z-10 rounded-full border border-blue-200 bg-white px-2 py-0.5 text-[11px] font-bold text-blue-800">
                {dimensions}
              </div>
            )}
            {img ? (
              <img
                src={img}
                alt={vehicle.label + " goods vehicle"}
                className="mt-4 h-24 object-contain"
              />
            ) : (
              <span className="mt-4 text-sm font-semibold text-muted-foreground">
                Vehicle image
              </span>
            )}
          </div>
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1 font-bold text-lg text-gray-900">
                <span className="truncate">{vehicle.label}</span>
                <Info className="h-4 w-4 shrink-0 text-gray-400" />
              </div>
              <p className="text-xs font-medium text-gray-500">
                {payload
                  ? String(payload) + " kg"
                  : vehicle.capacity_label || "Capacity on request"}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xl font-extrabold text-gray-900">₹{vehicle.base_fare}</p>
              <p className="text-[11px] text-muted-foreground">base fare</p>
            </div>
          </div>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed="false"
      className="flex w-full items-center justify-between rounded-2xl border-2 border-gray-200 bg-white p-3 text-left transition-all hover:border-gray-300"
    >
      <div className="flex min-w-0 items-center gap-3">
        {img ? (
          <img
            src={img}
            alt={vehicle.label + " goods vehicle"}
            className="h-10 w-14 shrink-0 object-contain"
          />
        ) : (
          <span className="grid h-10 w-14 shrink-0 place-items-center rounded-md bg-muted text-[10px]">
            Vehicle
          </span>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-bold text-gray-800">{vehicle.label}</span>
          </div>
          <p className="text-xs text-gray-500">
            {payload ? String(payload) + " kg" : vehicle.capacity_label || "Capacity on request"}
          </p>
        </div>
      </div>
      <span className="shrink-0 text-lg font-extrabold text-gray-900">₹{vehicle.base_fare}</span>
    </button>
  );
}
