/**
 * Free loading/unloading allowance and waiting (overtime) charges.
 *
 * Rules, per vehicle, configured by the team in Admin → Fares & vehicles:
 *  - Loading gets its own free window, counted from "Start loading" until the
 *    pickup code is verified (or the driver stops the clock).
 *  - Unloading gets its own free window, counted from "Start unloading" until
 *    the delivery code is verified (or the driver stops the clock).
 *  - Driving time between pickup and drop is never counted.
 *  - Beyond the free window, waiting is charged per minute at the vehicle's
 *    rate. The payable amount is calculated on the server at delivery.
 */
export const DEFAULT_OVERTIME_RATE_PER_MIN = 2;

export type LoadingTimerState = {
  freeMinutes: number;
  ratePerMin: number;
  elapsedMinutes: number;
  remainingMinutes: number;
  overtimeMinutes: number;
  overtimeCharge: number;
  /** mm:ss of free time left (00:00 once overtime starts) */
  countdown: string;
};

export function computeLoadingTimer(
  freeMinutes: number,
  startedAt: string | null | undefined,
  now: number = Date.now(),
  ratePerMin: number = DEFAULT_OVERTIME_RATE_PER_MIN,
): LoadingTimerState | null {
  if (!startedAt) return null;
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return null;

  const free = Math.max(0, Math.round(freeMinutes));
  const rate = Math.max(0, ratePerMin);
  const elapsedSec = Math.max(0, Math.floor((now - started) / 1000));
  const freeSec = free * 60;
  const remainingSec = Math.max(0, freeSec - elapsedSec);
  const overtimeMinutes = Math.max(0, Math.ceil((elapsedSec - freeSec) / 60));

  return {
    freeMinutes: free,
    ratePerMin: rate,
    elapsedMinutes: Math.floor(elapsedSec / 60),
    remainingMinutes: Math.ceil(remainingSec / 60),
    overtimeMinutes,
    overtimeCharge: Math.round(overtimeMinutes * rate),
    countdown: `${String(Math.floor(remainingSec / 60)).padStart(2, "0")}:${String(remainingSec % 60).padStart(2, "0")}`,
  };
}
