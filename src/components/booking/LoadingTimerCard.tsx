import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { computeLoadingTimer } from "@/lib/loading-timer";

/**
 * Live loading/unloading countdown. It only runs between the recorded start and
 * stop moments, so nobody is charged while the truck is simply driving. The
 * free window and per-minute rate come from the vehicle's own configuration and
 * the final amount is settled on the server when delivery is confirmed.
 */
export function LoadingTimerCard({
  freeMinutes,
  ratePerMin,
  startedAt,
  stoppedAt,
  title = "Loading / unloading time",
}: {
  freeMinutes: number;
  ratePerMin: number;
  startedAt: string | null | undefined;
  stoppedAt?: string | null;
  title?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (stoppedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [stoppedAt]);

  const reference = stoppedAt ? new Date(stoppedAt).getTime() : now;
  const state = computeLoadingTimer(freeMinutes, startedAt, reference, ratePerMin);
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
          {title}
          {stoppedAt ? " (stopped)" : ""}
        </p>
        <p className={`font-display text-2xl ${over ? "text-destructive" : "text-secondary"}`}>
          {over ? `+${state.overtimeMinutes}m` : state.countdown}
        </p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {over ? (
          <>
            Free {state.freeMinutes} min used up — waiting charge so far{" "}
            <span className="font-semibold text-destructive">₹{state.overtimeCharge}</span> (
            {state.overtimeMinutes} min × ₹{state.ratePerMin}/min). It is added to the final fare
            when delivery is confirmed.
          </>
        ) : (
          <>
            {state.freeMinutes} min free included. After that ₹{state.ratePerMin}/min waiting charge
            applies.
          </>
        )}
      </p>
    </div>
  );
}
