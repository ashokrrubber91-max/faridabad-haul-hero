import { LoadingTimerCard } from "@/components/booking/LoadingTimerCard";
import { DEFAULT_OVERTIME_RATE_PER_MIN } from "@/lib/loading-timer";
import type { VehicleType } from "@/lib/vehicles";

type BookingLike = {
  status: string;
  vehicle_type: string;
  fare: number | string;
  loading_started_at?: string | null;
  loading_stopped_at?: string | null;
  unloading_started_at?: string | null;
  unloading_stopped_at?: string | null;
  loading_overtime_minutes?: number | string | null;
  unloading_overtime_minutes?: number | string | null;
  overtime_charge?: number | string | null;
  final_fare?: number | string | null;
};

/**
 * One shared, honest view of loading/unloading time and waiting charges for
 * customers, drivers and the ops team. Live windows tick only while the clock is
 * running; the settled amount shown after delivery is the server's figure.
 */
export function WaitingChargesCard({
  booking,
  vehicle,
}: {
  booking: BookingLike;
  vehicle?: VehicleType;
}) {
  const rate = vehicle?.overtime_rate_per_min ?? DEFAULT_OVERTIME_RATE_PER_MIN;
  const freeLoading = vehicle?.free_loading_minutes ?? 60;
  const freeUnloading = vehicle?.free_unloading_minutes ?? 30;

  const settled = Number(booking.overtime_charge) || 0;
  const settledMins =
    (Number(booking.loading_overtime_minutes) || 0) +
    (Number(booking.unloading_overtime_minutes) || 0);
  const finalFare = Number(booking.final_fare) || Number(booking.fare) || 0;
  const isFinal = booking.status === "completed";

  if (isFinal) {
    if (settled <= 0) return null;
    return (
      <div className="mt-3 rounded-md border border-border bg-muted/40 p-3 text-xs">
        <div className="flex justify-between">
          <span>Waiting charge ({settledMins} min beyond free time)</span>
          <span className="font-semibold text-secondary">₹{settled.toFixed(0)}</span>
        </div>
        <div className="mt-1 flex justify-between border-t border-border pt-1 font-semibold">
          <span>Final fare</span>
          <span className="text-secondary">₹{finalFare.toFixed(0)}</span>
        </div>
      </div>
    );
  }

  return (
    <>
      {booking.loading_started_at && (
        <LoadingTimerCard
          freeMinutes={freeLoading}
          ratePerMin={rate}
          startedAt={booking.loading_started_at}
          stoppedAt={booking.loading_stopped_at}
          title="Loading time at pickup"
        />
      )}
      {booking.unloading_started_at && (
        <LoadingTimerCard
          freeMinutes={freeUnloading}
          ratePerMin={rate}
          startedAt={booking.unloading_started_at}
          stoppedAt={booking.unloading_stopped_at}
          title="Unloading time at drop"
        />
      )}
    </>
  );
}
