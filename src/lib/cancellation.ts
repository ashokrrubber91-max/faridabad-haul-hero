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
    return {
      fee: 0,
      label: "Free cancellation",
      detail: "No driver assigned yet — nothing will be charged.",
    };
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
      detail:
        "Your driver is already on the way — 10% of the fare (₹25–₹50) covers their trip to pickup.",
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

/** Human wording for who closed a trip and why, shared by customer, driver and admin views. */
export type CancellationSummary = {
  title: string;
  who: string | null;
  reason: string | null;
  /** When the trip was closed, ready to display; null when it was never recorded. */
  at: string | null;
  isPaymentFailure: boolean;
};

function closedAtLabel(value?: string | null): string | null {
  if (!value) return null;
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) return null;
  return t.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}


const ACTOR_LABEL: Record<string, string> = {
  customer: "Cancelled by customer",
  driver: "Cancelled by driver",
  admin: "Cancelled by MiniPort support",
  system: "Closed automatically by MiniPort",
};

const CATEGORY_TITLE: Record<string, string> = {
  customer_cancelled: "Cancelled by customer",
  driver_cancelled: "Cancelled by driver",
  admin_cancelled: "Cancelled by MiniPort support",
  expired: "Expired — no driver accepted",
};

export function cancellationSummary(booking: {
  status?: string | null;
  payment_status?: string | null;
  cancellation_reason?: string | null;
  cancelled_by?: string | null;
  cancellation_category?: string | null;
}): CancellationSummary | null {
  const status = booking.status ?? "";
  const closed = status === "cancelled" || status === "expired";
  const paymentFailed = booking.payment_status === "failed";

  if (!closed && paymentFailed) {
    return {
      title: "Payment failed — booking not cancelled",
      who: null,
      reason: "Retry the online payment or switch this same booking to cash.",
      isPaymentFailure: true,
    };
  }
  if (!closed) return null;

  const category = booking.cancellation_category ?? "";
  const actor = booking.cancelled_by ?? "";
  const title =
    CATEGORY_TITLE[category] ?? (status === "expired" ? CATEGORY_TITLE.expired : "Cancelled");
  const reason =
    typeof booking.cancellation_reason === "string" && booking.cancellation_reason.trim()
      ? booking.cancellation_reason.trim()
      : status === "expired"
        ? "No driver accepted this request in time. Nothing was charged."
        : null;

  return {
    title,
    who: ACTOR_LABEL[actor] ?? null,
    reason,
    isPaymentFailure: false,
  };
}
