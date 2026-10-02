export const HELPER_FEES = { 0: 0, 1: 250, 2: 500 } as const;

export function helperFeeFor(count: number): number {
  const safe = Math.max(0, Math.min(2, Math.trunc(count))) as 0 | 1 | 2;
  return HELPER_FEES[safe];
}

export function insuranceFeeFor(opted: boolean): number {
  return opted ? 10 : 0;
}

export function totalFare(baseFare: number, helperCount = 0, insuranceOpted = false): number {
  return Math.max(0, Number(baseFare) || 0) + helperFeeFor(helperCount) + insuranceFeeFor(insuranceOpted);
}

export function driverCommission(fare: number, commissionRate = 0.1, dailyPassActive = false): number {
  if (dailyPassActive) return 0;
  return Math.round(Math.max(0, Number(fare) || 0) * Math.max(0, commissionRate));
}

export function driverNetEarning(fare: number, commissionRate = 0.1, dailyPassActive = false): number {
  const safeFare = Math.max(0, Number(fare) || 0);
  return safeFare - driverCommission(safeFare, commissionRate, dailyPassActive);
}

export function gstBreakdown(totalInclusive: number, rate = 0.05) {
  const total = Math.max(0, Number(totalInclusive) || 0);
  const taxable = +(total / (1 + rate)).toFixed(2);
  const tax = +(total - taxable).toFixed(2);
  return { taxable, tax, cgst: +(tax / 2).toFixed(2), sgst: +(tax / 2).toFixed(2), total };
}

export function ewayBillRequired(shipmentValue: number): boolean {
  return (Number(shipmentValue) || 0) > 50_000;
}
