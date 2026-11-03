import { describe, expect, test } from "bun:test";
import {
  parseRideCommand,
  parseWeightKg,
  serviceAreaQuery,
  vehicleForWeight,
} from "../src/lib/voice-booking";

const catalogue = [
  { id: "bike_delivery", payload_kg: 20, weight_limit_kg: 20 },
  { id: "tata_ace", payload_kg: 750, weight_limit_kg: 750 },
  { id: "pickup_8ft", payload_kg: 1200, weight_limit_kg: 1200 },
  { id: "tata_407", payload_kg: 2500, weight_limit_kg: 2500 },
];

describe("voice ride command parser", () => {
  test("English from/to with weight and Tata Ace", () => {
    expect(parseRideCommand("Book a Tata Ace from Sector 15 to NIT 600 kg")).toEqual({
      pickup: "Sector 15",
      drop: "NIT",
      weightKg: 600,
      vehicle: "tata_ace",
    });
  });

  test("Hinglish se/tak with Pickup 8ft", () => {
    expect(parseRideCommand("Ballabgarh se Sector 74 tak pickup 8 feet 900 kilo")).toEqual({
      pickup: "Ballabgarh",
      drop: "Sector 74",
      weightKg: 900,
      vehicle: "pickup_8ft",
    });
  });

  test("labelled pickup/drop with Tata 407 and tons", () => {
    const r = parseRideCommand("pickup Tigaon Road drop Sector 21 Tata 407 2 ton");
    expect(r.pickup).toBe("Tigaon Road");
    expect(r.drop).toBe("Sector 21");
    expect(r.vehicle).toBe("tata_407");
    expect(r.weightKg).toBe(2000);
  });

  test("bike delivery is recognised", () => {
    expect(parseRideCommand("bike delivery from NIT 5 to Sector 16 10 kg").vehicle).toBe(
      "bike_delivery",
    );
  });

  test("rejects impossible weights above 50,000 kg", () => {
    expect(parseWeightKg("60 ton")).toBeNull();
    expect(parseWeightKg("0 kg")).toBeNull();
  });

  test("picks the smallest vehicle that fits the cargo", () => {
    expect(vehicleForWeight(600, catalogue)).toBe("tata_ace");
    expect(vehicleForWeight(751, catalogue)).toBe("pickup_8ft");
    expect(vehicleForWeight(3000, catalogue)).toBeNull();
  });

  test("keeps searches inside Faridabad", () => {
    expect(serviceAreaQuery("Sector 15")).toBe("Sector 15, Faridabad");
    expect(serviceAreaQuery("NIT Faridabad")).toBe("NIT Faridabad");
  });
});
