import { z } from "zod";

export const getAvailabilitySchema = z.object({
  staffId: z.string().cuid("Invalid staff ID"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  serviceId: z.string().cuid("Invalid service ID"),
});

export type GetAvailabilityDto = z.infer<typeof getAvailabilitySchema>;