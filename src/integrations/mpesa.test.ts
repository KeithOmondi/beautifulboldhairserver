import { describe, expect, it } from "vitest";
import { isFinalStkFailure } from "./mpesa";

describe("reading an M-Pesa status check", () => {
  it("treats paid and still-processing as not failed", () => {
    expect(isFinalStkFailure(0)).toBe(false); // paid
    expect(isFinalStkFailure(4999)).toBe(false); // the customer is still deciding
    expect(isFinalStkFailure(Number.NaN)).toBe(false); // unreadable is never a failure
  });
  it("treats cancelled, wrong PIN, no money and timeout as failed", () => {
    for (const c of [1, 1032, 1037, 2001, 1019]) expect(isFinalStkFailure(c)).toBe(true);
  });
});
