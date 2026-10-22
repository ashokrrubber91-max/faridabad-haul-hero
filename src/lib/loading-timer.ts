/**
 * Shared waiting allowance for Tata Ace (750 kg): 70 minutes loading + 20
 * minutes unloading = 90 minutes total. Unused loading minutes roll into
 * unloading. Only combined elapsed time beyond 90 minutes is chargeable.
 */
export const DEFAULT_OVERTIME_RATE_PER_MIN = 2;
export const TATA_ACE_LOADING_FREE_MINUTES = 70;
export const TATA_ACE_UNLOADING_BASE_FREE_MINUTES = 20;
export const TATA_ACE_TOTAL_FREE_MINUTES =
  TATA_ACE_LOADING_FREE_MINUTES + TATA_ACE_UNLOADING_BASE_FREE_MINUTES;

export type LoadingTimerState = {
  freeMinutes: number;
  ratePerMin: number;
  elapsedMinutes: number;
  remainingMinutes: number;
  overtimeMinutes: number;
  overtimeCharge: number;
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

/** Shared Tata Ace allowance calculation used by customer/driver timer views. */
export function computeTataAceSharedWaiting(
  loadingMinutes: number,
  unloadingMinutes: number,
  ratePerMin = DEFAULT_OVERTIME_RATE_PER_MIN,
) {
  const loading = Math.max(0, Math.ceil(loadingMinutes));
  const unloading = Math.max(0, Math.ceil(unloadingMinutes));
  const totalElapsed = loading + unloading;
  const loadingUnused = Math.max(0, TATA_ACE_LOADING_FREE_MINUTES - loading);
  const unloadingFree = TATA_ACE_UNLOADING_BASE_FREE_MINUTES + loadingUnused;
  const totalOvertime = Math.max(0, totalElapsed - TATA_ACE_TOTAL_FREE_MINUTES);
  // Attribute overtime first to loading beyond its 70-minute base; remaining
  // overtime is attributed to unloading, while the total charge stays shared.
  const loadingOvertime = Math.min(
    totalOvertime,
    Math.max(0, loading - TATA_ACE_LOADING_FREE_MINUTES),
  );
  const unloadingOvertime = totalOvertime - loadingOvertime;
  return {
    loadingMinutes: loading,
    unloadingMinutes: unloading,
    totalElapsedMinutes: totalElapsed,
    totalFreeMinutes: TATA_ACE_TOTAL_FREE_MINUTES,
    loadingBaseFreeMinutes: TATA_ACE_LOADING_FREE_MINUTES,
    unloadingFreeMinutes: unloadingFree,
    remainingFreeMinutes: Math.max(0, TATA_ACE_TOTAL_FREE_MINUTES - totalElapsed),
    loadingOvertimeMinutes: loadingOvertime,
    unloadingOvertimeMinutes: unloadingOvertime,
    overtimeMinutes: totalOvertime,
    overtimeCharge: Math.round(totalOvertime * Math.max(0, ratePerMin)),
  };
}
