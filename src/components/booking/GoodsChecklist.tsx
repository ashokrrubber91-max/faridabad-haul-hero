import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const PROHIBITED_ITEMS = [
  "Explosives, fireworks or ammunition",
  "Flammable liquids or gases (petrol, LPG cylinders, etc.)",
  "Live animals or birds",
  "Illegal / contraband goods or narcotics",
  "Hazardous chemicals or toxic substances",
  "Human remains or body parts",
];

export function GoodsChecklist({
  open,
  onOpenChange,
  onConfirmed,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirmed: () => void;
}) {
  const [checked, setChecked] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setChecked(false);
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-warning" /> Goods restrictions
          </DialogTitle>
          <DialogDescription>
            Please confirm your shipment does not contain any of the following before we book your truck.
          </DialogDescription>
        </DialogHeader>
        <ul className="list-inside list-disc space-y-1.5 rounded-md bg-muted/40 p-3 text-sm text-secondary">
          {PROHIBITED_ITEMS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm">
          <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} className="mt-0.5" />
          <span>
            I confirm my shipment contains none of the above hazardous or prohibited items and complies with
            MiniPort's transport policy.
          </span>
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!checked}
            onClick={() => {
              onConfirmed();
              onOpenChange(false);
            }}
          >
            Confirm & continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
