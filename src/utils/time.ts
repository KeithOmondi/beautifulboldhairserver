/**
 * All business logic runs in Africa/Nairobi (EAT). Kenya has no daylight saving, so the offset is
 * a constant UTC+3 and we can do exact arithmetic without depending on the server's own timezone.
 */

export const TIMEZONE = "Africa/Nairobi";
const OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" calendar date in Nairobi for an instant. */
export function nairobiDateString(date: Date): string {
  return new Date(date.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** Minutes since local midnight (Nairobi) for an instant. */
export function getMinutesFromMidnight(date: Date): number {
  const local = new Date(date.getTime() + OFFSET_MS);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

export function minutesToHHmm(minutes: number): string {
  const h = Math.floor(minutes / 60).toString().padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

/** "HH:mm" in Nairobi for an instant. */
export function nairobiTimeString(date: Date): string {
  return minutesToHHmm(getMinutesFromMidnight(date));
}

export function hhmmToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Instant of local midnight (Nairobi) at the start of the given "YYYY-MM-DD". */
export function dayStart(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00+03:00`);
}

/** Exclusive end of the day: local midnight of the following day. */
export function dayEnd(dateStr: string): Date {
  return new Date(dayStart(dateStr).getTime() + DAY_MS);
}

/** Instant at `minutes` after local midnight on `dateStr`. */
export function atMinutes(dateStr: string, minutes: number): Date {
  return new Date(dayStart(dateStr).getTime() + minutes * 60_000);
}

/** Day of week (0 = Sunday) for a "YYYY-MM-DD" calendar date. */
export function dayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

export function todayString(now = new Date()): string {
  return nairobiDateString(now);
}

/** First and last calendar day (YYYY-MM-DD) of the month containing dateStr. */
export function monthBounds(dateStr: string): { first: string; last: string } {
  const [y, m] = dateStr.split("-").map(Number);
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
  return { first, last };
}

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: TIMEZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatTime(date: Date): string {
  return nairobiTimeString(date);
}

export function timesOverlap(start1: number, end1: number, start2: number, end2: number): boolean {
  return start1 < end2 && start2 < end1;
}
