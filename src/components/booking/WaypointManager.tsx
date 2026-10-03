import { ArrowDown, ArrowUp, MapPin, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PlacePick } from "@/components/booking/LocationSearchOverlay";

export function WaypointManager({
  stops,
  onAdd,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  stops: PlacePick[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}) {
  return (
    <div className="space-y-2">
      {stops.length > 0 && (
        <ul className="space-y-2">
          {stops.map((s, i) => (
            <li
              key={`${s.address}-${i}`}
              className="flex items-center gap-2 rounded-md border bg-background p-2.5"
            >
              <MapPin className="h-4 w-4 shrink-0 text-warning" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Stop {i + 1}
                </p>
                <p className="truncate text-sm text-secondary">{s.address}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={i === 0}
                  onClick={() => onMoveUp(i)}
                  aria-label="Move stop up"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={i === stops.length - 1}
                  onClick={() => onMoveDown(i)}
                  aria-label="Move stop down"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive"
                  onClick={() => onRemove(i)}
                  aria-label="Remove stop"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Button type="button" variant="outline" size="sm" onClick={onAdd} className="w-full">
        <Plus className="h-3.5 w-3.5" /> Add a stop
      </Button>
    </div>
  );
}
