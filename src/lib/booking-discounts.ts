export function coinsToRedeem(requested: number, balance: number, fare: number, promo = 0): number {
  if (![requested, balance, fare, promo].every(Number.isFinite)) return 0;
  return Math.max(0, Math.min(Math.floor(requested), Math.floor(balance), Math.floor(Math.max(0, fare - promo))));
}

export function bookingDiscount(fare: number, promo: number, coins: number): number {
  return Math.min(Math.max(0, fare), Math.max(0, promo) + Math.max(0, coins));
}