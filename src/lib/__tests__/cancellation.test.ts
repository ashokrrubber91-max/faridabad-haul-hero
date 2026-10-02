import { describe, expect, it } from "vitest";
import { cancellationSummary } from "../cancellation";

describe("cancellation reason categorizer", () => {
  it("categorizes customer cancellations and preserves the reason", () => {
    const result = cancellationSummary({
      status: "cancelled",
      cancellation_category: "customer_cancelled",
      cancelled_by: "customer",
      cancellation_reason: "Changed my plan",
      cancelled_at: "2026-09-30T10:00:00.000Z",
    });

    expect(result?.title).toBe("Cancelled by customer");
    expect(result?.who).toBe("Cancelled by customer");
    expect(result?.reason).toBe("Changed my plan");
    expect(result?.isPaymentFailure).toBe(false);
  });

  it("handles driver, admin and expired categories", () => {
    expect(
      cancellationSummary({
        status: "cancelled",
        cancellation_category: "driver_cancelled",
        cancelled_by: "driver",
        cancellation_reason: "Vehicle issue",
        cancelled_at: "2026-09-30T10:00:00.000Z",
      })?.title,
    ).toBe("Cancelled by driver");

    expect(
      cancellationSummary({
        status: "cancelled",
        cancellation_category: "admin_cancelled",
        cancelled_by: "admin",
        cancellation_reason: "Safety review",
        cancelled_at: "2026-09-30T10:00:00.000Z",
      })?.title,
    ).toBe("Cancelled by MiniPort support");

    expect(
      cancellationSummary({
        status: "expired",
        cancellation_category: "expired",
        cancelled_by: "system",
        cancellation_reason: null,
        cancelled_at: "2026-09-30T10:00:00.000Z",
      })?.reason,
    ).toContain("No driver accepted");
  });

  it("does not label a failed payment as a cancellation", () => {
    const result = cancellationSummary({
      status: "pending",
      payment_status: "failed",
    });
    expect(result?.isPaymentFailure).toBe(true);
    expect(result?.title).toContain("Payment failed");
  });
});
