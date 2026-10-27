import { z } from "zod";

// Helper to validate ISO 8601 datetime strings
const isoDateString = z.string().refine((val) => !isNaN(Date.parse(val)), {
  message: "Invalid date format. Expected ISO 8601 string.",
});

// Helper to validate time strings (HH:mm)
const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
  message: "Invalid time format. Expected HH:mm (e.g., 09:00, 18:30)",
});

export const createShiftSchema = z.object({
  staffId: z.string().cuid("Invalid staff ID"),
  startAt: isoDateString,
  endAt: isoDateString,
  notes: z.string().optional(),
}).refine((data) => new Date(data.endAt) > new Date(data.startAt), {
  message: "End time must be after start time",
  path: ["endAt"],
});

export const createRecurringShiftSchema = z.object({
  staffId: z.string().cuid("Invalid staff ID"),
  dayOfWeek: z.number().int().min(0).max(6), // 0 = Sunday, 6 = Saturday
  startTime: timeString,
  endTime: timeString,
  repeatWeeks: z.number().int().min(1).max(12).default(4), // Default to 4 weeks ahead
}).refine((data) => {
  // Ensure endTime is after startTime (e.g., 09:00 to 18:00)
  // Note: This does not support overnight shifts (e.g., 22:00 to 02:00) for recurring templates yet.
  return data.endTime > data.startTime;
}, {
  message: "End time must be after start time",
  path: ["endTime"],
});

export const createBreakSchema = z.object({
  shiftId: z.string().cuid("Invalid shift ID"),
  startAt: isoDateString,
  endAt: isoDateString,
}).refine((data) => new Date(data.endAt) > new Date(data.startAt), {
  message: "Break end time must be after break start time",
  path: ["endAt"],
});

export const updateShiftSchema = z.object({
  startAt: isoDateString.optional(),
  endAt: isoDateString.optional(),
  notes: z.string().optional(),
}).refine((data) => {
  if (data.startAt && data.endAt) {
    return new Date(data.endAt) > new Date(data.startAt);
  }
  return true; // If only one is provided, skip the comparison
}, {
  message: "End time must be after start time",
  path: ["endAt"],
});

// Export types
export type CreateShiftDto = z.infer<typeof createShiftSchema>;
export type CreateRecurringShiftDto = z.infer<typeof createRecurringShiftSchema>;
export type CreateBreakDto = z.infer<typeof createBreakSchema>;
export type UpdateShiftDto = z.infer<typeof updateShiftSchema>;