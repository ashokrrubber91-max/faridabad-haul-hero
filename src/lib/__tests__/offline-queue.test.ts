import { describe, expect, it } from "vitest";
import { offlineRetryDelay } from "../offline-queue";

describe("offline queue retry backoff", () => {
  it("starts at one second and doubles up to one minute", () => {
    expect(offlineRetryDelay(0)).toBe(1000);
    expect(offlineRetryDelay(1)).toBe(2000);
    expect(offlineRetryDelay(2)).toBe(4000);
    expect(offlineRetryDelay(6)).toBe(60000);
    expect(offlineRetryDelay(20)).toBe(60000);
  });

  it("never produces a negative delay", () => {
    expect(offlineRetryDelay(-10)).toBe(1000);
  });
});
