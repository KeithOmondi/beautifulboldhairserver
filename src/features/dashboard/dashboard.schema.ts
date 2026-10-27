import { z } from "zod";

/**
 * Optional query parameters for the dashboard.
 * By default, it returns today's stats and the current month's stats.
 * If a date is provided, it calculates for that specific month/year.
 */
export const getDashboardQuerySchema = z.object({
  // Optional date to look at historical data (e.g., "2026-10")
  // Format: YYYY-MM
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
});

export type GetDashboardQueryDto = z.infer<typeof getDashboardQuerySchema>;