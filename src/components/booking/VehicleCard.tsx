import { useEffect, useState } from "react";
import { Check, Truck, Weight } from "lucide-react";
import { vehicleImageSrc, type VehicleType } from "@/lib/vehicles";
import aceImg from "@/assets/vehicle-tata-ace.jpg";
import pickupImg from "@/assets/vehicle-pickup-8ft.jpg";
import truck407Img from "@/assets/vehicle-tata-407.jpg";

/** Bundled artwork for the vehicles that shipped with the app. */
const BUILT_IN: Record<string, string> = {
  tata_ace: aceImg,
  pickup_8ft: pickupImg,
  tata_407: truck407Img,
};

export function useVehicleImage(vehicle: Pick<VehicleType, "id" | "image_url">) {
  const [src, setSrc] = useState<string | null>(BUILT_IN[vehicle.id] ?? null);

  useEffect(() => {
    let cancelled = false;
    if (!vehicle.image_url) {
      setSrc(BUILT_IN[vehicle.id] ?? null);
      return;
    }
    void vehicleImageSrc(vehicle.image_url).then((url) => {
      if (!cancelled) setSrc(url ?? BUILT_IN[vehicle.id] ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [vehicle.id, vehicle.image_url]);

  return src;
}

export function VehicleCard({
  vehicle,
  selected,
  onSelect,
}: {
  vehicle: VehicleType;
  selected: boolean;
  onSelect: () => void;
}) {
  const img = useVehicleImage(vehicle);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`relative flex w-full items-center gap-3 overflow-hidden rounded-lg border p-3 text-left transition-all ${
        selected
          ? "border-primary bg-accent shadow-sm ring-1 ring-primary"
          : "border-border hover:bg-muted"
      }`}
    >
      {img ? (
        <img
          src={img}
          alt={`${vehicle.label} goods vehicle`}
          loading="lazy"
          width={768}
          height={512}
          className="h-20 w-28 shrink-0 rounded-md bg-background object-contain"
        />
      ) : (
        <span className="grid h-20 w-28 shrink-0 place-items-center rounded-md bg-muted">
          <Truck className="h-7 w-7 text-muted-foreground" />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-secondary">{vehicle.label}</p>
        {vehicle.capacity_label && (
          <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-primary">
            <Weight className="h-3.5 w-3.5" /> Up to {vehicle.capacity_label}
          </p>
        )}
        {vehicle.load_area && (
          <p className="truncate text-xs text-muted-foreground">{vehicle.load_area}</p>
        )}
        {vehicle.good_for.length > 0 && (
          <p className="mt-1 truncate text-xs text-muted-foreground">
            Best for: {vehicle.good_for.join(", ")}
          </p>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">
          {vehicle.free_loading_minutes} min free loading · {vehicle.free_unloading_minutes} min free
          unloading
        </p>
      </div>

      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold text-secondary">₹{vehicle.base_fare}</p>
        <p className="text-[11px] text-muted-foreground">+ ₹{vehicle.per_km_fare}/km</p>
        {selected && (
          <span className="mt-2 inline-grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-3 w-3" />
          </span>
        )}
      </div>
    </button>
  );
}
