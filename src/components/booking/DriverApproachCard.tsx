import { useQuery } from "@tanstack/react-query";
import { PhoneCall, Truck, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { vehicleLabel } from "@/lib/booking";
import { addressLines } from "@/lib/address";
import { PlaceThumbnail } from "@/components/booking/PlaceThumbnail";

/**
 * Who is coming, in what vehicle, and where they are heading. Everything shown
 * here comes from the booking record and the participant-only contact function —
 * nothing is estimated or invented.
 */
export function DriverApproachCard({
  bookingId,
  driverId,
  vehicleType,
  phase,
  pickupAddress,
  pickupLat,
  pickupLng,
}: {
  bookingId: string;
  driverId: string | null;
  vehicleType: string;
  phase: "accepted" | "in_progress";
  pickupAddress: string;
  pickupLat?: number | null;
  pickupLng?: number | null;
}) {
  const contact = useQuery({
    queryKey: ["approach-contact", bookingId],
    enabled: !!driverId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("booking_contacts", {
        _booking_ids: [bookingId],
      });
      if (error) throw error;
      const row = (data ?? [])[0];
      return row ? { name: row.name, phone: row.phone } : null;
    },
  });

  const vehicle = useQuery({
    queryKey: ["approach-vehicle", driverId],
    enabled: !!driverId,
    queryFn: async () => {
      const { data } = await supabase
        .from("driver_kyc")
        .select("vehicle_number")
        .eq("driver_id", driverId!)
        .maybeSingle();
      return data?.vehicle_number ?? null;
    },
  });

  const pickup = addressLines(pickupAddress, pickupLat, pickupLng);

  return (
    <div className="mt-3 rounded-md border p-3">
      <div className="flex items-start gap-3">
        <PlaceThumbnail lat={pickupLat} lng={pickupLng} label="pickup point" />
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {phase === "accepted" ? "Driver coming to pickup" : "Trip in progress"}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-secondary">
            <User className="h-3.5 w-3.5 text-primary" />
            {contact.data?.name ?? (contact.isLoading ? "Loading driver…" : "Driver assigned")}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Truck className="h-3.5 w-3.5" />
            {vehicleLabel(vehicleType)}
            {vehicle.data ? ` · ${vehicle.data}` : ""}
          </p>
          <p className="mt-1 truncate text-xs text-secondary">{pickup.primary}</p>
          {pickup.secondary && (
            <p className="truncate text-[11px] text-muted-foreground">{pickup.secondary}</p>
          )}
        </div>
        {contact.data?.phone && (
          <Button size="sm" variant="outline" asChild>
            <a href={`tel:${contact.data.phone}`}>
              <PhoneCall className="h-3.5 w-3.5" /> Call
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
