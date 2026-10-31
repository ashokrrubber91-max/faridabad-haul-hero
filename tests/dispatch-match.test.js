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
