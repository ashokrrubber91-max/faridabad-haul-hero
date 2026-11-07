import { describe, expect, test } from "bun:test";
import {
  dispatchRadiusKm,
  haversineKm,
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

describe("Nearest-first distance windows", () => {
  const created = Date.parse("2026-11-07T10:00:00Z");
  const ride = { ...booking, created_at: "2026-11-07T10:00:00Z", pickup_lat: 28.4, pickup_lng: 77.31 };
  const at = (secs) => created + secs * 1000;
  const fix = (lat, now) => ({ lat, lng: 77.31, updatedAt: now });
  const near = (now) => ({ ...driver, location: fix(28.41, now) }); // ~1.1 km
  const mid = (now) => ({ ...driver, location: fix(28.445, now) }); // ~5 km
  const far = (now) => ({ ...driver, location: fix(28.5, now) }); // ~11 km

  test("radius widens 3 -> 6 -> 10 km, then opens to everyone", () => {
    expect(dispatchRadiusKm(0)).toBe(3);
    expect(dispatchRadiusKm(19.9)).toBe(3);
    expect(dispatchRadiusKm(20)).toBe(6);
    expect(dispatchRadiusKm(40)).toBe(10);
    expect(dispatchRadiusKm(60)).toBeNull();
  });

  test("first 20 seconds: only the nearby driver", () => {
    const now = at(5);
    expect(isRideAlertMatch(ride, near(now), now)).toBe(true);
    expect(isRideAlertMatch(ride, mid(now), now)).toBe(false);
    expect(isRideAlertMatch(ride, far(now), now)).toBe(false);
  });

  test("20-40 seconds: 6 km; 40-60 seconds: 10 km (11 km driver still waits)", () => {
    expect(isRideAlertMatch(ride, mid(at(25)), at(25))).toBe(true);
    expect(isRideAlertMatch(ride, far(at(45)), at(45))).toBe(false);
  });

  test("after 60 seconds every matching driver sees it, even without a location", () => {
    const now = at(70);
    expect(isRideAlertMatch(ride, far(now), now)).toBe(true);
    expect(isRideAlertMatch(ride, { ...driver, location: null }, now)).toBe(true);
  });

  test("a driver with no known or a stale location waits for the open-to-all stage", () => {
    const now = at(5);
    expect(isRideAlertMatch(ride, { ...driver, location: null }, now)).toBe(false);
    expect(isRideAlertMatch(ride, { ...driver, location: fix(28.41, now - 6 * 60 * 1000) }, now)).toBe(
      false,
    );
  });

  test("no distance rule when location is not tracked or the ride has no pickup coordinates", () => {
    expect(isRideAlertMatch(ride, driver, at(5))).toBe(true);
    const noCoords = { ...ride, pickup_lat: null, pickup_lng: null };
    expect(isRideAlertMatch(noCoords, { ...driver, location: null }, at(5))).toBe(true);
  });

  test("haversine matches the database: about 1.1 km per 0.01 degree of latitude", () => {
    expect(haversineKm(28.4, 77.31, 28.41, 77.31)).toBeCloseTo(1.11, 1);
  });
});
