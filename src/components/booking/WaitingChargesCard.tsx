import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { LoadingTimerCard } from "@/components/booking/LoadingTimerCard";
import { DEFAULT_OVERTIME_RATE_PER_MIN } from "@/lib/loading-timer";
import type { VehicleType } from "@/lib/vehicles";

type BookingLike = {
  status?: string | null;
  vehicle_type?: string | null;
  fare?: number | string | null;
  loading_started_at?: string | null;
  loading_stopped_at?: string | null;
  unloading_started_at?: string | null;
  unloading_stopped_at?: string | null;
  loading_overtime_minutes?: number | string | null;
  unloading_overtime_minutes?: number | string | null;
  overtime_charge?: number | string | null;
  final_fare?: number | string | null;
};

/** Shared waiting-time card for Tata Ace: 90 minutes total across loading + unloading. */
function TataAceSharedTimer({ booking, ratePerMin }: { booking: BookingLike; ratePerMin: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const running =
      (!!booking.loading_started_at && !booking.loading_stopped_at) ||
      (!!booking.unloading_started_at && !booking.unloading_stopped_at);
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [
    booking.loading_started_at,
    booking.loading_stopped_at,
    booking.unloading_started_at,
    booking.unloading_stopped_at,
  ]);

  const duration = (start?: string | null, stop?: string | null) => {
    if (!start) return 0;
    const s = new Date(start).getTime();
    if (Number.isNaN(s)) return 0;
    const e = stop ? new Date(stop).getTime() : now;
    return Math.max(0, Math.floor((e - s) / 1000));
  };

  const totalSec =
    duration(booking.loading_started_at, booking.loading_stopped_at) +
    duration(booking.unloading_started_at, booking.unloading_stopped_at);
  const freeSec = 90 * 60;
  const remainingSec = Math.max(0, freeSec - totalSec);
  const overtimeMinutes = Math.max(0, Math.ceil((totalSec - freeSec) / 60));
  const charge = Math.round(overtimeMinutes * ratePerMin);
  const totalMinutes = Math.floor(totalSec / 60);
  const isRunning =
    (!!booking.loading_started_at && !booking.loading_stopped_at) ||
    (!!booking.unloading_started_at && !booking.unloading_stopped_at);

  const mmss = `${String(Math.floor(remainingSec / 60)).padStart(2, "0")}:${String(remainingSec % 60).padStart(2, "0")}`;

  return (
    <div
      className={`mt-3 rounded-md border p-3 ${overtimeMinutes > 0 ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/40"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Timer
            className={`h-3.5 w-3.5 ${overtimeMinutes > 0 ? "text-destructive" : "text-primary"}`}
          />
          Total loading + unloading time{isRunning ? "" : " (stopped)"}
        </p>
        <p
          className={`font-display text-2xl ${overtimeMinutes > 0 ? "text-destructive" : "text-secondary"}`}
        >
          {overtimeMinutes > 0 ? `+${overtimeMinutes}m` : mmss}
        </p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        90 min total free for Tata Ace. Loading and unloading share the same 90-minute allowance.
        {totalMinutes > 0 && (
          <>
            {" "}
            Used: <span className="font-semibold text-secondary">{totalMinutes} min</span>.
          </>
        )}
        {overtimeMinutes > 0 ? (
          <>
            {" "}
            Waiting charge so far <span className="font-semibold text-destructive">
              ₹{charge}
            </span>{" "}
            ({overtimeMinutes} min × ₹{ratePerMin}/min).
          </>
        ) : (
          <>
            {" "}
            Remaining:{" "}
            <span className="font-semibold text-secondary">{Math.ceil(remainingSec / 60)} min</span>
            .
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Loading/unloading time and waiting charges.
 * Tata Ace uses one shared 90-minute allowance across both stages.
 * Other vehicles retain their configured separate loading/unloading allowances.
 */
export function WaitingChargesCard({
  booking,
  vehicle,
}: {
  booking: BookingLike;
  vehicle?: VehicleType;
}) {
  const rate = vehicle?.overtime_rate_per_min ?? DEFAULT_OVERTIME_RATE_PER_MIN;

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
          <span>
            {booking.vehicle_type === "tata_ace"
              ? `Waiting charge (${settledMins} min beyond 90 min total)`
              : `Waiting charge (${settledMins} min beyond free time)`}
          </span>
          <span className="font-semibold text-secondary">₹{settled.toFixed(0)}</span>
        </div>
        <div className="mt-1 flex justify-between border-t border-border pt-1 font-semibold">
          <span>Final fare</span>
          <span className="text-secondary">₹{finalFare.toFixed(0)}</span>
        </div>
      </div>
    );
  }

  if (booking.vehicle_type === "tata_ace") {
    return <TataAceSharedTimer booking={booking} ratePerMin={rate} />;
  }

  return (
    <>
      {booking.loading_started_at && (
        <LoadingTimerCard
          freeMinutes={vehicle?.free_loading_minutes ?? 60}
          ratePerMin={rate}
          startedAt={booking.loading_started_at}
          stoppedAt={booking.loading_stopped_at}
          title="Loading time at pickup"
        />
      )}
      {booking.unloading_started_at && (
        <LoadingTimerCard
          freeMinutes={vehicle?.free_unloading_minutes ?? 30}
          ratePerMin={rate}
          startedAt={booking.unloading_started_at}
          stoppedAt={booking.unloading_stopped_at}
          title="Unloading time at drop"
        />
      )}
    </>
  );
}
