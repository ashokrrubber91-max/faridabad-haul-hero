import { describe, expect, test } from "bun:test";
import { getOfferedDriverId } from "../src/lib/driver-alerts.server";

function offerClient(result) {
  const calls = [];
  const query = {
    select(value) {
      calls.push(["select", value]);
      return query;
    },
    eq(key, value) {
      calls.push(["eq", key, value]);
      return query;
    },
    gt(key, value) {
      calls.push(["gt", key, value]);
      return query;
    },
    limit(value) {
      calls.push(["limit", value]);
      return Promise.resolve(result);
    },
  };
  return {
    calls,
    client: {
      from(table) {
        calls.push(["from", table]);
        return query;
      },
    },
  };
}

describe("Optional sequential driver push", () => {
  for (const code of ["42P01", "PGRST205"]) {
    test(`skips push when dispatch schema is absent (${code})`, async () => {
      const { client } = offerClient({ data: null, error: { code, message: "Missing table" } });
      expect(await getOfferedDriverId(client, "booking-1")).toBeNull();
    });
  }

  test("targets only the booking's offered, unexpired driver", async () => {
    const { client, calls } = offerClient({ data: [{ driver_id: "driver-1" }], error: null });
    expect(await getOfferedDriverId(client, "booking-1")).toBe("driver-1");
    expect(calls).toContainEqual(["from", "booking_dispatch_offers"]);
    expect(calls).toContainEqual(["eq", "booking_id", "booking-1"]);
    expect(calls).toContainEqual(["eq", "status", "offered"]);
    expect(calls).toContainEqual(["limit", 1]);
    const expiryFilter = calls.find(([method, key]) => method === "gt" && key === "expires_at");
    expect(Number.isFinite(Date.parse(expiryFilter?.[2]))).toBe(true);
  });

  test("does not choose another driver when there is no live offer", async () => {
    const { client } = offerClient({ data: [], error: null });
    expect(await getOfferedDriverId(client, "booking-1")).toBeNull();
  });

  test("keeps permission and service failures visible", async () => {
    const { client } = offerClient({ data: null, error: { code: "42501", message: "Denied" } });
    await expect(getOfferedDriverId(client, "booking-1")).rejects.toThrow("Denied");
  });
});