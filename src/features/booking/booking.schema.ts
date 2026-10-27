import { z } from "zod";
import { BookingSource } from "../../generated/prisma/client";

export const createBookingSchema = z.object({
  clientId: z.string().cuid("Invalid client ID"),
  staffId: z.string().cuid("Invalid staff ID"),
  serviceId: z.string().cuid("Invalid service ID"),
  // Zod's .datetime() ensures it's a full ISO string (e.g., 2026-11-02T09:00:00+03:00)
  startAt: z.string().datetime({ message: "Start time must be a valid ISO 8601 string" }),
  source: z.nativeEnum(BookingSource).default(BookingSource.WALKIN),
  notes: z.string().optional(),
});

export const rescheduleBookingSchema = z.object({
  newStartAt: z.string().datetime({ message: "New start time must be a valid ISO 8601 string" }),
  staffId: z.string().cuid("Invalid staff ID").optional(),
});

export type CreateBookingDto = z.infer<typeof createBookingSchema>;
export type RescheduleBookingDto = z.infer<typeof rescheduleBookingSchema>;