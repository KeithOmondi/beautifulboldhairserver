import { describe, expect, it } from "vitest";
import { commissionFor, effectiveRate } from "../commission";

describe("commissionFor", () => {
  it("takes the percentage of the net price", () => {
    expect(commissionFor(3500, 0, 1500)).toBe(525);
    expect(commissionFor(3500, 500, 1500)).toBe(450);
  });

  it("rounds down to whole shillings", () => {
    expect(commissionFor(999, 0, 1250)).toBe(124); // 124.875
  });

  it("never goes negative when the discount exceeds the price", () => {
    expect(commissionFor(1000, 1500, 2000)).toBe(0);
  });
});

describe("effectiveRate", () => {
  it("prefers the service override, even when it is 0", () => {
    expect(effectiveRate(1500, 2000)).toBe(2000);
    expect(effectiveRate(1500, 0)).toBe(0);
  });

  it("falls back to the default, then to 0", () => {
    expect(effectiveRate(1500, null)).toBe(1500);
    expect(effectiveRate(null, undefined)).toBe(0);
  });
});
