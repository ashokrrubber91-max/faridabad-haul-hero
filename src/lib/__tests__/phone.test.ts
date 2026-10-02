import { describe, expect, it } from "vitest";
import { INDIAN_MOBILE } from "@/hooks/useAuth";

describe("Indian mobile validation", () => {
  it("accepts exactly 10 digits starting with 6-9", () => {
    for (const phone of ["6123456789", "7123456789", "8123456789", "9123456789"]) {
      expect(INDIAN_MOBILE.test(phone)).toBe(true);
    }
  });

  it("rejects invalid length, prefix and formatted input", () => {
    expect(INDIAN_MOBILE.test("5123456789")).toBe(false);
    expect(INDIAN_MOBILE.test("912345678")).toBe(false);
    expect(INDIAN_MOBILE.test("91234567890")).toBe(false);
    expect(INDIAN_MOBILE.test("+919123456789")).toBe(false);
  });
});
