import { describe, expect, it } from "vitest";
import { atMinutes } from "../time";
import { clampToOpening, summarizeOpening, type OpeningHours } from "../opening-hours";

const monFri: OpeningHours = Object.fromEntries(["1", "2", "3", "4", "5"].map((d) => [d, { start: "09:00", end: "17:00" }]));
const MON = "2026-11-02"; // Monday
const SAT = "2026-11-07";

describe("opening hours", () => {
  it("does nothing when the owner has not set hours", () => {
    const w = [{ start: atMinutes(MON, 480), end: atMinutes(MON, 1200) }];
    expect(clampToOpening(MON, w, null)).toEqual(w);
  });

  it("trims a stylist's day to the salon's hours", () => {
    const [w] = clampToOpening(MON, [{ start: atMinutes(MON, 7 * 60), end: atMinutes(MON, 20 * 60) }], monFri);
    expect(w).toEqual({ start: atMinutes(MON, 9 * 60), end: atMinutes(MON, 17 * 60) });
  });

  it("closes the whole day on a day the salon is shut", () => {
    expect(clampToOpening(SAT, [{ start: atMinutes(SAT, 9 * 60), end: atMinutes(SAT, 17 * 60) }], monFri)).toEqual([]);
  });

  it("drops a window that lies wholly outside opening hours", () => {
    expect(clampToOpening(MON, [{ start: atMinutes(MON, 18 * 60), end: atMinutes(MON, 20 * 60) }], monFri)).toEqual([]);
  });

  it("describes the hours in plain words", () => {
    expect(summarizeOpening(monFri)).toBe("Mon to Fri: 9 am to 5 pm");
    const every: OpeningHours = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, { start: "08:30", end: "20:00" }]));
    expect(summarizeOpening(every)).toBe("Mon to Sun: 8:30 am to 8 pm");
    expect(summarizeOpening({ ...monFri, "6": { start: "10:00", end: "15:00" } })).toBe("Mon to Fri: 9 am to 5 pm\nSat: 10 am to 3 pm");
    expect(summarizeOpening(null)).toBeNull();
  });
});
