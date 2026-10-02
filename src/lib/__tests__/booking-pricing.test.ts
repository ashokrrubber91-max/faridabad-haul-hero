import { describe, expect, it } from "vitest";
import { cargoInsuranceCharge, dailyPassDeduction, gstLineItems, helperCharge, requiresEwayBill } from "../booking-pricing";

describe("MiniPort B2B pricing", () => {
  it("adds helper charges", () => {
    expect(helperCharge(0)).toBe(0);
    expect(helperCharge(1)).toBe(250);
    expect(helperCharge(2)).toBe(500);
  });
  it("makes the ₹99 daily pass commission-free", () => {
    expect(dailyPassDeduction(true, 99)).toBe(0);
    expect(dailyPassDeduction(false, 99)).toBe(99);
  });
  it("adds cargo insurance at ₹10", () => {
    expect(cargoInsuranceCharge(false)).toBe(0);
    expect(cargoInsuranceCharge(true)).toBe(10);
  });
  it("calculates GST line items", () => {
    expect(gstLineItems(1000)).toEqual({ subtotal: 1000, tax: 180, total: 1180 });
  });
  it("requires an E-Way Bill above ₹50,000", () => {
    expect(requiresEwayBill(50000)).toBe(false);
    expect(requiresEwayBill(50000.01)).toBe(true);
  });
});
