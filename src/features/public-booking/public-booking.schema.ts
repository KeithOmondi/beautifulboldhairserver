import { z } from "zod";

const phone = z.string().regex(/^(?:\+?254|0)([17]\d{8})$/, "Enter a valid Kenyan phone number (e.g. 0712345678)");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

export const publicAvailabilitySchema = z.object({
  serviceId: z.string().cuid(),
  date,
  /** Omit (or "any") to search across all stylists. */
  staffId: z.string().optional(),
});

export const createPublicBookingSchema = z.object({
  serviceId: z.string().cuid("Invalid service"),
  staffId: z.string().optional(), // omit / "any" = first free stylist
  startAt: z.string().datetime({ offset: true, message: "Invalid start time" }),
  name: z.string().trim().min(2, "Please enter your name").max(80),
  phone,
  allergies: z.string().trim().max(300).optional(),
});

export const publicRescheduleSchema = z.object({
  newStartAt: z.string().datetime({ offset: true }),
});

export type PublicAvailabilityQuery = z.infer<typeof publicAvailabilitySchema>;
export type CreatePublicBookingInput = z.infer<typeof createPublicBookingSchema>;
