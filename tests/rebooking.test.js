import { describe, expect, test } from "bun:test";
import { hasExactCoordinates, repeatBookingLocation } from "../src/lib/rebooking";

describe("Book Again location prefill", () => {
  test("preserves the previous pickup coordinates and address", async () => {
    expect(
      await repeatBookingLocation({
        address: "Sector 15, Faridabad",
        latitude: 28.4089,
        longitude: 77.3178,
      }),
    ).toEqual({ address: "Sector 15, Faridabad", lat: 28.4089, lng: 77.3178 });
  });
  test("never treats missing coordinates as a valid default pin", () => {
    expect(hasExactCoordinates(null, 77.3178)).toBe(false);
    expect(hasExactCoordinates(28.4089, null)).toBe(false);
    expect(hasExactCoordinates(NaN, 77.3178)).toBe(false);
  });
  test("retains zero-valued valid coordinates", async () => {
    expect(
      await repeatBookingLocation({ address: "Previous drop", latitude: 0, longitude: 0 }),
    ).toEqual({ address: "Previous drop", lat: 0, lng: 0 });
  });
});
