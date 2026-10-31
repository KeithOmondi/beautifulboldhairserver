import { atMinutes, dayOfWeek, hhmmToMinutes, minutesToHHmm } from "../../utils/time";

/**
 * Pure availability engine: no database, no clock. Everything is passed in, so it is fully unit-testable.
 * All instants are real Dates; calendar days are "YYYY-MM-DD" in Africa/Nairobi.
 */

export type WeeklyHours = Record<string, { start: string; end: string } | null | undefined>;

export interface Interval {
  start: Date;
  end: Date;
}

export interface ComputeSlotsInput {
  date: string; // YYYY-MM-DD (Nairobi)
  durationMin: number;
  /** Gap kept free around every booking/hold. */
  bufferMin: number;
  stepMin?: number;
  /** Working windows for the day (shifts, or the default weekly hours). */
  windows: Interval[];
  /** Bookings and active holds: these get buffer applied on both sides. */
  bookings: Interval[];
  /** Breaks and time off: hard blocks, no buffer. */
  blocks: Interval[];
  now: Date;
  minNoticeHours: number;
}

export interface Slot {
  startAt: Date;
  endAt: Date;
  startTime: string;
  endTime: string;
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

export function windowsFromWeeklyHours(date: string, weekly: WeeklyHours | null | undefined): Interval[] {
  if (!weekly) return [];
  const entry = weekly[String(dayOfWeek(date))];
  if (!entry) return [];
  const start = hhmmToMinutes(entry.start);
  const end = hhmmToMinutes(entry.end);
  if (end <= start) return [];
  return [{ start: atMinutes(date, start), end: atMinutes(date, end) }];
}

export function computeSlots(input: ComputeSlotsInput): Slot[] {
  const step = input.stepMin ?? 15;
  const durationMs = input.durationMin * 60_000;
  const bufferMs = input.bufferMin * 60_000;
  const earliest = input.now.getTime() + input.minNoticeHours * 3_600_000;

  const busy: Interval[] = [
    ...input.bookings.map((b) => ({
      start: new Date(b.start.getTime() - bufferMs),
      end: new Date(b.end.getTime() + bufferMs),
    })),
    ...input.blocks,
  ];

  const slots: Slot[] = [];
  const seen = new Set<number>();

  for (const win of input.windows) {
    // Align the first candidate to the step grid, measured from local midnight.
    const dayStartMs = atMinutes(input.date, 0).getTime();
    const stepMs = step * 60_000;
    const offset = Math.max(0, win.start.getTime() - dayStartMs);
    let t = dayStartMs + Math.ceil(offset / stepMs) * stepMs;

    for (; t + durationMs <= win.end.getTime(); t += stepMs) {
      if (t < earliest || seen.has(t)) continue;
      const candidate: Interval = { start: new Date(t), end: new Date(t + durationMs) };
      if (busy.some((b) => overlaps(candidate, b))) continue;

      seen.add(t);
      const startMin = Math.round((t - dayStartMs) / 60_000);
      slots.push({
        startAt: candidate.start,
        endAt: candidate.end,
        startTime: minutesToHHmm(startMin),
        endTime: minutesToHHmm(startMin + input.durationMin),
      });
    }
  }

  return slots.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}
