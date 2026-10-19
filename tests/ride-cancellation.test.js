import { describe, expect, test } from "bun:test";
import { canCancel, cancellationSummary } from "../src/lib/cancellation";

describe("Customer ride cancellation", () => {
  test("pending and assigned rides can be cancelled", () => {
    expect(canCancel("pending")).toBe(true);
    expect(canCancel("accepted")).toBe(true);
  });
  test("in-progress rides retain cancellation access", () => {
    expect(canCancel("in_progress")).toBe(true);
  });
  test("closed rides cannot be cancelled again", () => {
    for (const status of ["completed", "cancelled", "expired"])
      expect(canCancel(status)).toBe(false);
  });
  test("a real cancellation is not mistaken for an online payment failure", () => {
    expect(
      cancellationSummary({
        status: "cancelled",
        payment_status: "pending",
        cancellation_category: "customer_cancelled",
      })?.isPaymentFailure,
    ).toBe(false);
    expect(
      cancellationSummary({ status: "pending", payment_status: "failed" })?.isPaymentFailure,
    ).toBe(true);
  });
});
