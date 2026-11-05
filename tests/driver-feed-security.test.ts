import { describe, expect, test } from "bun:test";
import { driverFeedRpcErrorMessage, isMissingDriverFeedRpc } from "../src/lib/driver-feed-security";

describe("secure driver dispatch feed", () => {
  test("recognizes a missing PostgREST RPC", () => {
    expect(isMissingDriverFeedRpc({ code: "PGRST202", message: "Function not found" })).toBe(true);
  });

  test("recognizes a missing PostgreSQL function", () => {
    expect(isMissingDriverFeedRpc({ code: "42883", message: "undefined function" })).toBe(true);
  });

  test("does not classify unrelated errors as missing RPC", () => {
    expect(isMissingDriverFeedRpc({ code: "42501", message: "permission denied" })).toBe(false);
  });

  test("uses a safe message for a missing secure feed", () => {
    expect(driverFeedRpcErrorMessage({ code: "PGRST202", message: "internal schema detail" })).toContain(
      "Secure driver dispatch",
    );
  });
});
