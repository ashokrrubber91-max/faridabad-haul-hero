import { describe, expect, it } from "vitest";
import {
  driverCommission,
  driverNetEarning,
  ewayBillRequired,
  gstBreakdown,
  helperFeeFor,
  insuranceFeeFor,
  totalFare,
} from "../enterprise-pricing";

describe("MiniPort enterprise pricing", () => {
  it("adds helper charges to the base fare", () => {
    expect(helperFeeFor(0)).toBe(0);
    expect(helperFeeFor(1)).toBe(250);
    expect(helperFeeFor(2)).toBe(500);
    expect(totalFare(1000, 2, false)).toBe(1500);
  });

  it("charges ₹10 cargo insurance when selected", () => {
    expect(insuranceFeeFor(false)).toBe(0);
    expect(insuranceFeeFor(true)).toBe(10);
    expect(totalFare(1000, 1, true)).toBe(1260);
  });

  it("makes the ₹99 daily pass commission-free", () => {
    expect(driverCommission(1000, 0.1, false)).toBe(100);
    expect(driverCommission(1000, 0.1, true)).toBe(0);
    expect(driverNetEarning(1000, 0.1, true)).toBe(1000);
  });

  it("splits GST line items correctly", () => {
    const gst = gstBreakdown(1050);
    expect(gst.taxable).toBe(1000);
    expect(gst.cgst).toBe(25);
    expect(gst.sgst).toBe(25);
    expect(gst.total).toBe(1050);
  });

  it("requires an E-Way Bill only above ₹50,000", () => {
    expect(ewayBillRequired(50000)).toBe(false);
    expect(ewayBillRequired(50000.01)).toBe(true);
  });
});
