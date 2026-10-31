import { describe, expect, it } from "vitest";
import { atMinutes } from "../../../utils/time";
import { computeSlots, windowsFromWeeklyHours } from "../engine";

const DATE = "2026-11-02"; // a Monday
const NOW = new Date("2026-10-01T00:00:00+03:00"); // far in the past: notice never interferes

const day = (start: string, end: string) => {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return [{ start: atMinutes(DATE, sh! * 60 + sm!), end: atMinutes(DATE, eh! * 60 + em!) }];
};
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return atMinutes(DATE, h! * 60 + m!);
};

const base = { date: DATE, durationMin: 60, bufferMin: 0, bookings: [], blocks: [], now: NOW, minNoticeHours: 0 };

describe("computeSlots", () => {
  it("offers every 15 minutes until the service no longer fits", () => {
    const slots = computeSlots({ ...base, windows: day("09:00", "11:00") });
    expect(slots.map((s) => s.startTime)).toEqual(["09:00", "09:15", "09:30", "09:45", "10:00"]);
    expect(slots.at(-1)!.endTime).toBe("11:00");
  });

  it("removes times that overlap a booking", () => {
    const slots = computeSlots({
      ...base,
      windows: day("09:00", "13:00"),
      bookings: [{ start: at("10:00"), end: at("11:00") }],
    });
    const times = slots.map((s) => s.startTime);
    expect(times).toContain("09:00");
    expect(times).not.toContain("09:15"); // 09:15-10:15 collides
    expect(times).not.toContain("10:30");
    expect(times).toContain("11:00");
  });

  it("keeps the buffer free on both sides of a booking", () => {
    const slots = computeSlots({
      ...base,
      bufferMin: 15,
      windows: day("09:00", "13:00"),
      bookings: [{ start: at("10:00"), end: at("11:00") }],
    });
    const times = slots.map((s) => s.startTime);
    expect(times).not.toContain("09:00"); // 09:00-10:00 touches the 10:00 booking, needs 15 min gap    expect(times).toContain("11:15");
    expect(times).not.toContain("11:00");
  });

  it("does not apply buffer to breaks", () => {
    const slots = computeSlots({
      ...base,
      bufferMin: 15,
      windows: day("09:00", "15:00"),
      blocks: [{ start: at("12:00"), end: at("13:00") }],
    });
    const times = slots.map((s) => s.startTime);
    expect(times).toContain("11:00"); // ends exactly when the break starts
    expect(times).toContain("13:00"); // starts exactly when the break ends
    expect(times).not.toContain("11:15");
  });

  it("honours minimum notice", () => {
    const now = at("09:00");
    const slots = computeSlots({ ...base, windows: day("09:00", "13:00"), now, minNoticeHours: 2 });
    expect(slots[0]!.startTime).toBe("11:00");
  });

  it("returns nothing when the service is longer than the shift", () => {
    expect(computeSlots({ ...base, durationMin: 240, windows: day("09:00", "12:00") })).toEqual([]);
  });

  it("returns real instants that round-trip as +03:00", () => {
    const [first] = computeSlots({ ...base, windows: day("09:00", "11:00") });
    expect(first!.startAt.toISOString()).toBe("2026-11-02T06:00:00.000Z");
  });

  it("never offers the same start twice with overlapping windows", () => {
    const slots = computeSlots({ ...base, windows: [...day("09:00", "11:00"), ...day("10:00", "12:00")] });
    const times = slots.map((s) => s.startTime);
    expect(new Set(times).size).toBe(times.length);
  });
});

describe("windowsFromWeeklyHours", () => {
  const weekly = { "1": { start: "09:00", end: "17:30" }, "0": null };

  it("uses the entry for that weekday", () => {
    const [w] = windowsFromWeeklyHours(DATE, weekly);
    expect(w!.start.toISOString()).toBe("2026-11-02T06:00:00.000Z");
    expect(w!.end.toISOString()).toBe("2026-11-02T14:30:00.000Z");
  });

  it("is empty on days off or when unset", () => {
    expect(windowsFromWeeklyHours("2026-11-01", weekly)).toEqual([]); // Sunday
    expect(windowsFromWeeklyHours("2026-11-03", weekly)).toEqual([]); // Tuesday not listed
    expect(windowsFromWeeklyHours(DATE, null)).toEqual([]);
  });
});
