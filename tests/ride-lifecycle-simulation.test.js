import { describe, expect, test } from "bun:test";
import { OFFER_TTL_S, runRideLifecycleSimulation } from "../scripts/ride-lifecycle-sim";

describe("Ride lifecycle simulation (10,000 concurrent users, offline)", () => {
  const report = runRideLifecycleSimulation({ users: 10000, seed: 42 });

  test("simulates 10,000 users split into customers and drivers", () => {
    expect(report.users).toBe(10000);
    expect(report.customers + report.drivers).toBe(10000);
    expect(report.bookings).toBe(report.customers);
  });

  test("breaks no dispatch, acceptance or OTP rule", () => {
    expect(report.violations).toEqual([]);
  });

  test("every booking ends completed or expired unassigned", () => {
    expect(report.stillOpen).toBe(0);
    expect(report.completed + report.expiredUnassigned).toBe(report.bookings);
    expect(report.completed).toBeGreaterThan(0);
  });

  test("each completed ride has exactly one accepted offer", () => {
    expect(report.offersAccepted).toBe(report.completed);
  });

  test("offers that time out move on after 20 seconds", () => {
    expect(OFFER_TTL_S).toBe(20);
    expect(report.offersExpired).toBeGreaterThan(0);
    expect(report.offersSent).toBe(
      report.offersAccepted + report.offersDeclined + report.offersExpired,
    );
  });

  test("late, rival and wrong-code attempts are rejected", () => {
    expect(report.rejectedAcceptAttempts).toBeGreaterThan(0);
    expect(report.rejectedOtpAttempts).toBeGreaterThan(0);
  });

  test("same seed gives the same result", () => {
    const again = runRideLifecycleSimulation({ users: 2000, seed: 7 });
    const twice = runRideLifecycleSimulation({ users: 2000, seed: 7 });
    expect({ ...again, wallClockMs: 0 }).toEqual({ ...twice, wallClockMs: 0 });
  });
});
