export function helperCharge(helperCount: number): number {
  if (helperCount === 2) return 500;
  if (helperCount === 1) return 250;
  return 0;
}
export function cargoInsuranceCharge(insuranceOpted: boolean): number {
  return insuranceOpted ? 10 : 0;
}
export function dailyPassDeduction(hasActivePass: boolean, commission: number): number {
  return hasActivePass ? 0 : Math.max(0, commission);
}
export function gstLineItems(subtotal: number, rate = 0.18) {
  const safeSubtotal = Math.max(0, Number(subtotal) || 0);
  const tax = Math.round(safeSubtotal * rate * 100) / 100;
  return { subtotal: safeSubtotal, tax, total: Math.round((safeSubtotal + tax) * 100) / 100 };
}
export function requiresEwayBill(cargoValue: number): boolean {
  return Number(cargoValue) > 50_000;
}
