import { describe, expect, it } from "vitest";
import {
  addDays,
  atMinutes,
  dayEnd,
  dayOfWeek,
  dayStart,
  getMinutesFromMidnight,
  monthBounds,
  nairobiDateString,
  nairobiTimeString,
} from "../../../utils/time";
import { normalizePhone } from "../../../utils/phone";

describe("Nairobi time helpers", () => {
  it("treats 23:30 UTC as the next calendar day in Nairobi", () => {
    const instant = new Date("2026-11-01T23:30:00Z");
    expect(nairobiDateString(instant)).toBe("2026-11-02");
    expect(nairobiTimeString(instant)).toBe("02:30");
  });

  it("converts midnight boundaries exactly", () => {
    expect(dayStart("2026-11-02").toISOString()).toBe("2026-11-01T21:00:00.000Z");
    expect(dayEnd("2026-11-02").toISOString()).toBe("2026-11-02T21:00:00.000Z");
  });

  it("round-trips minutes from midnight", () => {
    const t = atMinutes("2026-11-02", 14 * 60 + 45);
    expect(getMinutesFromMidnight(t)).toBe(885);
    expect(nairobiDateString(t)).toBe("2026-11-02");
  });

  it("does arithmetic on calendar dates without drifting", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(dayOfWeek("2026-11-02")).toBe(1);
    expect(monthBounds("2028-02-10")).toEqual({ first: "2028-02-01", last: "2028-02-29" });
  });
});

describe("normalizePhone", () => {
  it.each([
    ["0712345678", "+254712345678"],
    ["0112345678", "+254112345678"],
    ["254712345678", "+254712345678"],
    ["+254 712 345 678", "+254712345678"],
    ["0712-345-678", "+254712345678"],
  ])("normalises %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["", "12345", "0812345678", "+255712345678", "07123456789"])("rejects %s", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});
