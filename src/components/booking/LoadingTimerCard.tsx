import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { computeLoadingTimer, OVERTIME_RATE_PER_MIN } from "@/lib/loading-timer";

/**
 * Live loading/unloading countdown. Starts when the pickup OTP is verified.
 * Free time: 90 min for the 500 kg tempo, 60 min for larger trucks. Overtime ₹2/min.
 */
export function LoadingTimerCard({
  vehicleType,
  phase,
  startedAt,
  stoppedAt,
}: {
  vehicleType: string;
  phase: "loading" | "unloading";
  startedAt: string | null | undefined;
  stoppedAt?: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const state = computeLoadingTimer(vehicleType, startedAt, stoppedAt, now);
  if (!state) return null;

  const over = state.overtimeMinutes > 0;

  return (
    <div
      className={`mt-3 rounded-md border p-3 ${
        over ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/40"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Timer className={`h-3.5 w-3.5 ${over ? "text-destructive" : "text-primary"}`} />
          {phase === "loading" ? "Loading time" : "Unloading time"}
        </p>
        <p className={`font-display text-2xl ${over ? "text-destructive" : "text-secondary"}`}>
          {over ? `+${state.overtimeMinutes}m` : state.countdown}
        </p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {stoppedAt ? (
          <>Timer stopped. {state.overtimeMinutes > 0 ? `Overtime charge ₹${state.overtimeCharge} applies.` : "No overtime charge."}</>
        ) : over ? (
          <>
            Free {state.freeMinutes} min used up — overtime charge{" "}
            <span className="font-semibold text-destructive">₹{state.overtimeCharge}</span> ({state.overtimeMinutes} min
            × ₹{OVERTIME_RATE_PER_MIN}/min) will be added to the fare.
          </>
        ) : (
          <>
            {state.freeMinutes} min free included. After that ₹{OVERTIME_RATE_PER_MIN}/min waiting charge applies.
          </>
        )}
      </p>
    </div>
  );
}
