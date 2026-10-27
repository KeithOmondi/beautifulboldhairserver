import { z } from "zod";

/**
 * Validates the phone number for an OTP request.
 * We use a basic regex here to ensure it's a valid Kenyan number format,
 * preventing garbage data from hitting the SMS/Email provider.
 */
export const requestOtpSchema = z.object({
  phone: z
    .string()
    .regex(
      /^(?:\+?254|0)([17]\d{8})$/,
      "Invalid Kenyan phone number (e.g., 0712345678)"
    ),
});

/**
 * Validates the OTP verification request.
 */
export const verifyOtpSchema = z.object({
  phone: z
    .string()
    .regex(
      /^(?:\+?254|0)([17]\d{8})$/,
      "Invalid Kenyan phone number"
    ),
  code: z.string().length(6, "OTP must be exactly 6 digits"),
});

/**
 * Validates the request to hold a slot.
 * Requires the client to select a staff, service, and time.
 * Also captures their name and allergies BEFORE they pay via M-Pesa.
 */
export const holdSlotSchema = z.object({
  staffId: z.string().cuid("Invalid staff ID"),
  serviceId: z.string().cuid("Invalid service ID"),
  startAt: z.string().datetime({ 
    offset: true, 
    message: "Start time must be a valid ISO 8601 string with timezone offset" 
  }),
  name: z.string().min(2, "Name must be at least 2 characters").trim(),
  allergies: z.string().optional(),
});

/**
 * Validates the final booking confirmation.
 * The holdId proves they hold the slot, and we collect their details.
 */
export const confirmPublicBookingSchema = z.object({
  holdId: z.string().cuid("Invalid hold ID"),
  name: z.string().min(2, "Name must be at least 2 characters").trim(),
  allergies: z.string().optional(),
  isFirstLash: z.boolean().default(false),
});

// Export the inferred types for the controllers
export type RequestOtpDto = z.infer<typeof requestOtpSchema>;
export type VerifyOtpDto = z.infer<typeof verifyOtpSchema>;
export type HoldSlotDto = z.infer<typeof holdSlotSchema>;
export type ConfirmPublicBookingDto = z.infer<typeof confirmPublicBookingSchema>;