/**
 * Free loading/unloading time and overtime (waiting) charges.
 * Timers run independently for loading and unloading and stop at their persisted end time.
 */
export const OVERTIME_RATE_PER_MIN = 2; // ₹2 per minute

/** Tempo-class vehicles (≈500 kg) get 90 minutes free; larger standard trucks get 60. */
export function freeMinutesFor(vehicleType: string): number {
  return vehicleType === "tata_ace" ? 90 : 60;
}

export type LoadingTimerState = {
  freeMinutes: number;
  elapsedMinutes: number;
  remainingMinutes: number;
  overtimeMinutes: number;
  overtimeCharge: number;
  /** mm:ss of free time left (00:00 once overtime starts) */
  countdown: string;
};

export function computeLoadingTimer(
  vehicleType: string,
  startedAt: string | null | undefined,
  stoppedAt: string | null | undefined = null,
  now: number = Date.now(),
): LoadingTimerState | null {
  if (!startedAt) return null;
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return null;

  const freeMinutes = freeMinutesFor(vehicleType);
  const stopped = stoppedAt ? new Date(stoppedAt).getTime() : Number.NaN;
  const end = Number.isNaN(stopped) ? now : stopped;
  const elapsedSec = Math.max(0, Math.floor((end - started) / 1000));
  const freeSec = freeMinutes * 60;
  const remainingSec = Math.max(0, freeSec - elapsedSec);
  const overtimeMinutes = Math.max(0, Math.ceil((elapsedSec - freeSec) / 60));

  return {
    freeMinutes,
    elapsedMinutes: Math.floor(elapsedSec / 60),
    remainingMinutes: Math.ceil(remainingSec / 60),
    overtimeMinutes,
    overtimeCharge: overtimeMinutes * OVERTIME_RATE_PER_MIN,
    countdown: `${String(Math.floor(remainingSec / 60)).padStart(2, "0")}:${String(remainingSec % 60).padStart(2, "0")}`,
  };
}
