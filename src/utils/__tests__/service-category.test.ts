import { describe, expect, it } from "vitest";
import { normalizeCategory } from "../service-category";

describe("service categories", () => {
  it("sorts every spelling into the two sides of the business", () => {
    for (const v of ["lash", "Lashes ", "LASH EXTENSIONS", "eyelash"]) expect(normalizeCategory(v)).toBe("Lashes");
    for (const v of ["wigs", "Hair", "braids", "Hair & Wigs", "silk press"]) expect(normalizeCategory(v)).toBe("Hair & Wigs");
  });
  it("keeps anything else as typed, tidied up, and treats blank as none", () => {
    expect(normalizeCategory("  nails  ")).toBe("Nails");
    expect(normalizeCategory("   ")).toBeNull();
    expect(normalizeCategory(null)).toBeNull();
  });
});
