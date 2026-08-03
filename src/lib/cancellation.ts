/**
 * Dynamic cancellation charges. Customers may cancel any time before completion;
 * the fee grows as the driver invests more time in the trip.
 */
export type CancellationQuote = {
  fee: number;
  label: string;
  detail: string;
};

export function cancellationQuote(
  status: string,
  fare: number | string,
  acceptedAt?: string | null,
  now: number = Date.now(),
): CancellationQuote {
  const amount = Number(fare) || 0;

  if (status === "pending") {
    return { fee: 0, label: "Free cancellation", detail: "No driver assigned yet — nothing will be charged." };
  }

  if (status === "accepted") {
    const since = acceptedAt ? (now - new Date(acceptedAt).getTime()) / 60000 : 0;
    if (since <= 5) {
      return {
        fee: 0,
        label: "Free cancellation",
        detail: `Free for the first 5 minutes after a driver accepts (${Math.max(0, Math.ceil(5 - since))} min left).`,
      };
    }
    const fee = Math.min(50, Math.max(25, Math.round(amount * 0.1)));
    return {
      fee,
      label: `Cancellation charge ₹${fee}`,
      detail: "Your driver is already on the way — 10% of the fare (₹25–₹50) covers their trip to pickup.",
    };
  }

  if (status === "in_progress") {
    const fee = Math.round(amount * 0.25);
    return {
      fee,
      label: `Cancellation charge ₹${fee}`,
      detail: "The trip has already started, so 25% of the fare is charged.",
    };
  }

  return { fee: 0, label: "Cannot be cancelled", detail: "This trip is already closed." };
}

export function canCancel(status: string): boolean {
  return status === "pending" || status === "accepted" || status === "in_progress";
}
