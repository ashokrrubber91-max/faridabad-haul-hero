import { describe, expect, it } from "vitest";
import { fareFor } from "../vehicles";

describe("fareFor", () => {
  it("returns zero for zero or negative distance", () => {
    const vehicle = { base_fare: 100, per_km_fare: 20 };
    expect(fareFor(vehicle, 0)).toBe(0);
    expect(fareFor(vehicle, -2)).toBe(0);
  });

  it("calculates base fare plus distance pricing", () => {
    expect(fareFor({ base_fare: 100, per_km_fare: 20 }, 5)).toBe(200);
    expect(fareFor({ base_fare: 150, per_km_fare: 12.5 }, 8)).toBe(250);
  });

  it("rounds the payable fare to whole rupees", () => {
    expect(fareFor({ base_fare: 99, per_km_fare: 10.25 }, 3)).toBe(130);
  });
});
