import { Check } from "lucide-react";
import { VEHICLES, VEHICLE_DETAILS, type VehicleId } from "@/lib/booking";

/** CSS/SVG isometric truck illustration — no external assets. Color varies by vehicle size. */
function TruckIllustration({ vehicle, selected }: { vehicle: VehicleId; selected: boolean }) {
  const cabColor = selected ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))";
  const bodyColor = selected ? "hsl(var(--primary) / 0.75)" : "hsl(var(--muted-foreground) / 0.55)";
  const bedLength = vehicle === "tata_ace" ? 46 : vehicle === "pickup_8ft" ? 58 : 70;

  return (
    <svg viewBox="0 0 160 90" className="h-20 w-full" role="img" aria-label="Truck illustration">
      {/* ground shadow */}
      <ellipse cx="80" cy="78" rx="60" ry="6" fill="hsl(var(--foreground) / 0.08)" />
      {/* isometric cargo bed */}
      <g transform="translate(20,20)">
        <polygon
          points={`0,40 20,28 ${20 + bedLength},28 ${bedLength},40`}
          fill={bodyColor}
        />
        <polygon
          points={`0,40 20,28 20,10 0,22`}
          fill={bodyColor}
          opacity="0.85"
        />
        <polygon
          points={`20,28 ${20 + bedLength},28 ${20 + bedLength},10 20,10`}
          fill={bodyColor}
          opacity="0.65"
        />
        {/* cab */}
        <polygon points={`${20 + bedLength},28 ${38 + bedLength},18 ${38 + bedLength},32 ${20 + bedLength},40`} fill={cabColor} />
        <polygon points={`${20 + bedLength},28 ${38 + bedLength},18 ${34 + bedLength},10 ${16 + bedLength},20`} fill={cabColor} opacity="0.8" />
        {/* windshield */}
        <polygon
          points={`${23 + bedLength},22 ${33 + bedLength},17 ${31 + bedLength},22 ${22 + bedLength},26`}
          fill="hsl(var(--background) / 0.8)"
        />
        {/* wheels */}
        <circle cx="14" cy="42" r="6" fill="hsl(var(--secondary))" />
        <circle cx={16 + bedLength * 0.55} cy="42" r="6" fill="hsl(var(--secondary))" />
        <circle cx={30 + bedLength} cy="42" r="6" fill="hsl(var(--secondary))" />
      </g>
    </svg>
  );
}

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
      className={`relative flex flex-col overflow-hidden rounded-lg border p-3 text-left transition-all ${
        selected ? "border-primary bg-accent shadow-sm ring-1 ring-primary" : "border-border hover:bg-muted"
      }`}
    >
      {selected && (
        <span className="absolute right-2 top-2 rounded-full bg-primary p-1 text-primary-foreground">
          <Check className="h-3 w-3" />
        </span>
      )}
      <TruckIllustration vehicle={id} selected={selected} />
      <p className="mt-2 text-sm font-semibold text-secondary">{v.label}</p>
      <p className="text-xs text-muted-foreground">Capacity {details.weightLimit} · {details.loadArea}</p>
      <p className="mt-1 text-xs text-muted-foreground">Best for: {details.goodTor.join(", ")}</p>
      <p className="mt-2 text-xs font-semibold text-muted-foreground">
        Base ₹{v.base} + ₹{v.perKm}/km
      </p>
    </button>
  );
}
