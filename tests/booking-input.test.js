import { describe, expect, test } from "bun:test";
import {
  BOOKING_NOTES_MAX,
  bookingAddressError,
  bookingPlaceSchema,
  customerBookingNotes,
  normalizeContactPhone,
} from "../src/lib/booking-input";

describe("booking input limits", () => {
  test("accepts a formatted Indian contact number within the stored 13-character limit", () => {
    expect(normalizeContactPhone("+91 98765 43210")).toBe("+919876543210");
    expect(
      bookingPlaceSchema.parse({
        address: "Sector 15, Faridabad",
        lat: 28.4089,
        lng: 77.3178,
        contactPhone: "+91 98765 43210",
      }).contactPhone,
    ).toBe("+919876543210");
  });

  test("keeps multi-stop addresses and contacts out of the 500-character driver note", () => {
    const result = customerBookingNotes("N".repeat(300), {
      gstin: "06AAAAA0000A1Z5",
      business_name: "Example Business Private Limited",
    });
    expect(result).toBe(
      `${"N".repeat(300)} · Billed to GSTIN 06AAAAA0000A1Z5 (Example Business Private Limited)`,
    );
    expect(result.length).toBeLessThanOrEqual(BOOKING_NOTES_MAX);
    expect(result).not.toContain("Stops:");
    expect(result).not.toContain("Sender:");
    expect(result).not.toContain("Receiver:");
  });

  test("uses the same 200-character address boundary for client preflight and server validation", () => {
    const longAddress = "A".repeat(201);
    expect(
      bookingAddressError([{ label: "Pickup", address: longAddress }]),
    ).toBe("Pickup address must be between 3 and 200 characters. Choose a shorter address.");
    expect(
      bookingPlaceSchema.safeParse({
        address: longAddress,
        lat: 28.4089,
        lng: 77.3178,
      }).success,
    ).toBe(false);
    expect(bookingAddressError([{ label: "Stop 1", address: "A".repeat(200) }])).toBeNull();
  });
});
