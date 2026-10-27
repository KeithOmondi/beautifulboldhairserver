/**
 * Time Utility
 * 
 * All times in this application are normalized to Africa/Nairobi (EAT).
 * Kenya does not observe Daylight Saving Time, so the offset is always UTC+3.
 * 
 * However, we use Intl.DateTimeFormat to be 100% safe and handle date math 
 * without external libraries like date-fns or moment.
 */

const TIMEZONE = "Africa/Nairobi";

/**
 * Returns the current date/time in Nairobi.
 */
export function nowInNairobi(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: TIMEZONE }));
}

/**
 * Formats a Date object into a readable string for the salon staff.
 * Example: "Mon, 27 Oct 2026 at 14:30"
 */
export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: TIMEZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * Formats a Date object into just a time string (HH:mm).
 * Used for shift displays and calendar slots.
 */
export function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * Converts a Date object into "minutes from midnight" for a specific day.
 * This is the exact format the Availability Engine uses to calculate overlaps.
 * 
 * Example: A date of "2026-10-27T14:30:00+03:00" returns 870 (14 * 60 + 30).
 */
export function getMinutesFromMidnight(date: Date): number {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const hours = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const minutes = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
  
  return hours * 60 + minutes;
}

/**
 * Checks if two time ranges overlap.
 * @param start1 Start time of first slot (in minutes from midnight)
 * @param end1 End time of first slot
 * @param start2 Start time of second slot
 * @param end2 End time of second slot
 */
export function timesOverlap(start1: number, end1: number, start2: number, end2: number): boolean {
  return start1 < end2 && start2 < end1;
}

/**
 * Returns the start and end of the current day in Nairobi time.
 * Useful for daily cash-up and reporting queries.
 */
export function getTodayRange(): { start: Date; end: Date } {
  const now = nowInNairobi();
  
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}