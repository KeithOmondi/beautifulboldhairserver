import type { Shift, Break } from "../../generated/prisma/client";

/**
 * Input for creating a single shift for a staff member on a specific date.
 */
export interface CreateShiftInput {
  staffId: string;
  startAt: string; // ISO 8601 string (e.g., "2026-10-28T09:00:00+03:00")
  endAt: string;   // ISO 8601 string
  notes?: string;
}

/**
 * Input for creating a recurring weekly roster.
 * e.g., "Every Monday from 09:00 to 18:00"
 */
export interface CreateRecurringShiftInput {
  staffId: string;
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  startTime: string; // "09:00"
  endTime: string;   // "18:00"
  repeatWeeks: number; // How many weeks ahead to generate (e.g., 4)
}

/**
 * Input for adding a break to an existing shift.
 */
export interface CreateBreakInput {
  startAt: string; // ISO 8601 string
  endAt: string;   // ISO 8601 string
}

/**
 * A shift enriched with its breaks, used for API responses.
 */
export type ShiftWithBreaks = Shift & {
  breaks: Break[];
};

/**
 * Update payload for an existing shift.
 */
export interface UpdateShiftInput {
  startAt?: string;
  endAt?: string;
  notes?: string;
}