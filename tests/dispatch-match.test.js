import { describe, expect, test } from "bun:test";
import {
  isRideAlertMatch,
  resolveDriverVehicleType,
  selectMatchedDriverIds,
} from "../src/lib/dispatch-match";

const booking = {
  status: "pending",
  driver_id: null,
  cancelled_at: null,
  service_zone: "Faridabad",
  vehicle_type: "tata_ace",
  expires_at: null,
};
const driver = {
  isOnline: true,
  kycApproved: true,
  serviceZone: "Faridabad",
  vehicleType: "tata_ace",
};

describe("Ride alert matching", () => {
  test("alerts an online, verified driver in the same zone with the same vehicle", () => {
    expect(isRideAlertMatch(booking, driver)).toBe(true);
  });

  test("does not alert an offline driver", () => {
    expect(isRideAlertMatch(booking, { ...driver, isOnline: false })).toBe(false);
  });

  test("does not alert an unverified driver", () => {
    expect(isRideAlertMatch(booking, { ...driver, kycApproved: false })).toBe(false);
  });

  test("does not alert a driver in another zone", () => {
    expect(isRideAlertMatch(booking, { ...driver, serviceZone: "Gurugram" })).toBe(false);
  });

  test("does not alert a driver with a different vehicle", () => {
    expect(isRideAlertMatch(booking, { ...driver, vehicleType: "tata_407" })).toBe(false);
  });

  test("does not alert a driver whose vehicle is unknown", () => {
    expect(isRideAlertMatch(booking, { ...driver, vehicleType: null })).toBe(false);
  });

  test("uses the same Faridabad default when both booking and driver zones are unset", () => {
    expect(
      isRideAlertMatch({ ...booking, service_zone: null }, { ...driver, serviceZone: null }),
    ).toBe(true);
  });

  test("does not let an unset driver zone match a different explicit zone", () => {
    expect(
      isRideAlertMatch({ ...booking, service_zone: "Gurugram" }, { ...driver, serviceZone: null }),
    ).toBe(false);
  });

  test("filters a 5,000-driver candidate simulation without duplicate driver ids", () => {
    const candidates = Array.from({ length: 5000 }, (_, index) => ({
      ...driver,
      id: `driver-${index}`,
      isOnline: index % 3 !== 0,
      kycApproved: index % 5 !== 0,
      serviceZone: index % 11 === 0 ? "Gurugram" : "Faridabad",
      vehicleType: index % 7 === 0 ? "tata_ace" : "tata_407",
    }));
    const matched = selectMatchedDriverIds(booking, candidates);
    expect(new Set(matched).size).toBe(matched.length);
    expect(matched.every((id) => Number(id.slice(7)) % 3 !== 0)).toBe(true);
    expect(matched.every((id) => Number(id.slice(7)) % 5 !== 0)).toBe(true);
    expect(matched.every((id) => Number(id.slice(7)) % 7 === 0)).toBe(true);
    expect(matched.every((id) => Number(id.slice(7)) % 11 !== 0)).toBe(true);
  });

  test("keeps 250 customer booking matches isolated across 1,000 drivers", async () => {
    const candidates = Array.from({ length: 1000 }, (_, index) => ({
      ...driver,
      id: `driver-${index}`,
      isOnline: index % 4 !== 0,
      kycApproved: index % 5 !== 0,
      serviceZone: index % 2 === 0 ? "Faridabad" : "Gurugram",
      vehicleType: index % 3 === 0 ? "tata_ace" : "tata_407",
    }));
    const requests = Array.from({ length: 250 }, (_, index) => ({
      ...booking,
      service_zone: index % 2 === 0 ? "Faridabad" : "Gurugram",
      vehicle_type: index % 3 === 0 ? "tata_ace" : "tata_407",
    }));
    const results = await Promise.all(
      requests.map(async (request) => selectMatchedDriverIds(request, candidates)),
    );

    expect(results).toHaveLength(250);
    for (const [requestIndex, matches] of results.entries()) {
      const request = requests[requestIndex];
      expect(new Set(matches).size).toBe(matches.length);
      expect(
        matches.every((id) => {
          const index = Number(id.slice(7));
          const correctZone = (index % 2 === 0) === (request.service_zone === "Faridabad");
          const correctVehicle = (index % 3 === 0) === (request.vehicle_type === "tata_ace");
          return index % 4 !== 0 && index % 5 !== 0 && correctZone && correctVehicle;
        }),
      ).toBe(true);
    }
  });

  test("does not alert for taken, cancelled or expired rides", () => {
    expect(isRideAlertMatch({ ...booking, driver_id: "d2" }, driver)).toBe(false);
    expect(isRideAlertMatch({ ...booking, cancelled_at: "2026-10-31T10:00:00Z" }, driver)).toBe(
      false,
    );
    const now = Date.parse("2026-10-31T10:00:00Z");
    expect(isRideAlertMatch({ ...booking, expires_at: "2026-10-31T09:59:00Z" }, driver, now)).toBe(
      false,
    );
  });

  test("does not alert for scheduled rides before they are released", () => {
    expect(isRideAlertMatch({ ...booking, status: "scheduled" }, driver)).toBe(false);
  });

  test("uses the catalogue vehicle and ignores a registration number", () => {
    const ids = ["tata_ace", "pickup_8ft"];
    expect(resolveDriverVehicleType(null, "tata_ace", ids)).toBe("tata_ace");
    expect(resolveDriverVehicleType("pickup_8ft", "tata_ace", ids)).toBe("pickup_8ft");
    expect(resolveDriverVehicleType(null, "HR51TEST", ids)).toBeNull();
  });

  test("notifies only matched drivers who have not passed", () => {
    const drivers = [
      { ...driver, id: "match" },
      { ...driver, id: "passed" },
      { ...driver, id: "other-vehicle", vehicleType: "tata_407" },
      { ...driver, id: "offline", isOnline: false },
    ];
    expect(selectMatchedDriverIds(booking, drivers, new Set(["passed"]))).toEqual(["match"]);
  });
});
