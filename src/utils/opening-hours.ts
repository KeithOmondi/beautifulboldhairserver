import { windowsFromWeeklyHours, type Interval, type WeeklyHours } from "../engines/availability/engine";

/**
 * The salon's own opening days and hours, set by the owner. Keys are "0" (Sunday) to "6" (Saturday);
 * a missing or null day is closed. Staff can only be booked inside these hours.
 */
export type OpeningHours = WeeklyHours;

/** Keeps only the parts of each working window that fall inside the salon's opening hours for that day. */
export function clampToOpening(date: string, windows: Interval[], opening: OpeningHours | null | undefined): Interval[] {
  if (!opening) return windows;
  const open = windowsFromWeeklyHours(date, opening);
  const out: Interval[] = [];
  for (const w of windows) {
    for (const o of open) {
      const start = w.start > o.start ? w.start : o.start;
      const end = w.end < o.end ? w.end : o.end;
      if (start < end) out.push({ start, end });
    }
  }
  return out;
}

const ORDER = [1, 2, 3, 4, 5, 6, 0];
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function clock12(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h! >= 12 ? "pm" : "am";
  const hour = h! % 12 === 0 ? 12 : h! % 12;
  return m ? `${hour}:${String(m).padStart(2, "0")} ${suffix}` : `${hour} ${suffix}`;
}

/** "Mon to Fri: 9 am to 6 pm" lines, grouping consecutive days that share the same hours. */
export function summarizeOpening(opening: OpeningHours | null | undefined): string | null {
  if (!opening) return null;
  const lines: string[] = [];
  let i = 0;
  while (i < ORDER.length) {
    const day = opening[String(ORDER[i])];
    if (!day) { i++; continue; }
    let j = i;
    while (j + 1 < ORDER.length) {
      const next = opening[String(ORDER[j + 1])];
      if (!next || next.start !== day.start || next.end !== day.end) break;
      j++;
    }
    const first = SHORT[ORDER[i]!]!;
    const last = SHORT[ORDER[j]!]!;
    const label = i === j ? first : j === i + 1 ? `${first} and ${last}` : `${first} to ${last}`;
    lines.push(`${label}: ${clock12(day.start)} to ${clock12(day.end)}`);
    i = j + 1;
  }
  return lines.length ? lines.join("\n") : "Closed";
}
