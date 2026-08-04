import { Check, Weight } from "lucide-react";
import { VEHICLES, VEHICLE_DETAILS, type VehicleId } from "@/lib/booking";
import aceImg from "@/assets/vehicle-tata-ace.jpg";
import pickupImg from "@/assets/vehicle-pickup-8ft.jpg";
import truck407Img from "@/assets/vehicle-tata-407.jpg";

const IMAGES: Record<VehicleId, string> = {
  tata_ace: aceImg,
  pickup_8ft: pickupImg,
  tata_407: truck407Img,
};

export function VehicleCard({
  id,
  selected,
  onSelect,
}: {
  id: VehicleId;
  selected: boolean;
  onSelect: () => void;
}) {
  const v = VEHICLES.find((x) => x.id === id)!;
  const details = VEHICLE_DETAILS[id];

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`relative flex w-full items-center gap-3 overflow-hidden rounded-lg border p-3 text-left transition-all ${
        selected ? "border-primary bg-accent shadow-sm ring-1 ring-primary" : "border-border hover:bg-muted"
      }`}
    >
      <img
        src={IMAGES[id]}
        alt={`${v.label} mini truck`}
        loading="lazy"
        width={768}
        height={512}
        className="h-20 w-28 shrink-0 rounded-md bg-background object-contain"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-secondary">{v.label}</p>
        <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-primary">
          <Weight className="h-3.5 w-3.5" /> Up to {details.weightLimit}
        </p>
        <p className="truncate text-xs text-muted-foreground">{details.loadArea}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">Best for: {details.goodTor.join(", ")}</p>
      </div>

      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold text-secondary">₹{v.base}</p>
        <p className="text-[11px] text-muted-foreground">+ ₹{v.perKm}/km</p>
        {selected && (
          <span className="mt-2 inline-grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-3 w-3" />
          </span>
        )}
      </div>
    </button>
  );
}
