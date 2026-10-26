import { describe, expect, test } from "bun:test";
import { coinsToRedeem, bookingDiscount } from "../src/lib/booking-discounts";
import { canShareItinerary, remainingLoadCapacity, sharedLoadFare } from "../src/lib/co-loading";
import { sanitizeDriverNotes, validateNoteFile } from "../src/lib/driver-notes";

describe("MiniPort coin rules", () => {
  test("each redeemed coin discounts exactly one rupee", () => { expect(bookingDiscount(500, 0, coinsToRedeem(125, 200, 500))).toBe(125); });
  test("redemption cannot exceed balance", () => { expect(coinsToRedeem(500, 80, 1000)).toBe(80); });
  test("redemption cannot exceed fare after a promo", () => { expect(coinsToRedeem(500, 500, 200, 50)).toBe(150); });
  test("negative and invalid coin input cannot add value", () => { expect(coinsToRedeem(-10, 100, 200)).toBe(0); expect(coinsToRedeem(NaN, 100, 200)).toBe(0); });
});

const loads = [
  { bookingId: "a", customerId: "one", vehicleId: "tata_ace", weightKg: 600, standardFare: 400, optedIn: true },
  { bookingId: "b", customerId: "two", vehicleId: "tata_ace", weightKg: 150, standardFare: 200, optedIn: true },
];
const stops = [{ bookingId: "a", kind: "pickup" }, { bookingId: "b", kind: "pickup" }, { bookingId: "a", kind: "drop" }, { bookingId: "b", kind: "drop" }];
describe("Shared-load planning", () => {
  test("600 kg on a 750 kg vehicle leaves 150 kg", () => { expect(remainingLoadCapacity(600, 750)).toBe(150); expect(remainingLoadCapacity(750, 750)).toBeNull(); });
  test("each matched customer receives 25 percent off", () => { expect(sharedLoadFare(400, true)).toBe(300); expect(sharedLoadFare(200, true)).toBe(150); });
  test("unmatched loads retain the standard fare", () => { expect(sharedLoadFare(400, false)).toBe(400); });
  test("600 plus 150 kg fits but 600 plus 151 kg does not", () => { expect(canShareItinerary(loads, stops, 750)).toBe(true); expect(canShareItinerary([loads[0], { ...loads[1], weightKg: 151 }], stops, 750)).toBe(false); });
  test("delivery cannot precede pickup", () => { expect(canShareItinerary(loads, [stops[2], ...stops], 750)).toBe(false); });
  test("every customer must consent", () => { expect(canShareItinerary([loads[0], { ...loads[1], optedIn: false }], stops, 750)).toBe(false); });
});
describe("Driver note safety", () => {
  test("credential artifacts are removed", () => { expect(sanitizeDriverNotes("Boxes https://example.com/#access_token=private refresh_token=private").trim()).toBe("Boxes"); });
  test("ordinary notes and genuine delivery links survive", () => { expect(sanitizeDriverNotes("Gate token=42 https://example.com/goods")).toBe("Gate token=42 https://example.com/goods"); });
  test("unsupported or oversized media is rejected", () => { expect(validateNoteFile({ type: "image/svg+xml", size: 20 }, "photo")).not.toBeNull(); expect(validateNoteFile({ type: "image/jpeg", size: 6 * 1024 * 1024 }, "photo")).not.toBeNull(); expect(validateNoteFile({ type: "audio/webm", size: 1024 }, "audio")).toBeNull(); });
});