import { z } from "zod";

const phone = z.string().regex(/^(?:\+?254|0)([17]\d{8})$/, "Invalid Kenyan phone number (e.g. 0712345678)");

export const createBookingSchema = z
  .object({
    // Either an existing client, or a name + phone for a new one.
    clientId: z.string().cuid("Invalid client ID").optional(),
    clientName: z.string().trim().min(2, "Client name is required").optional(),
    clientPhone: phone.optional(),
    staffId: z.string().cuid("Invalid staff ID"),
    serviceId: z.string().cuid("Invalid service ID"),
    startAt: z.string().datetime({ offset: true, message: "Start time must be a valid ISO 8601 string" }),
    source: z.enum(["WALKIN", "PHONE"]).default("WALKIN"),
    discount: z.number().int().min(0).default(0),
    notes: z.string().max(500).optional(),
  })
  .refine((d) => d.clientId || (d.clientName && d.clientPhone), {
    message: "Choose an existing client or enter a name and phone number",
    path: ["clientId"],
  });

export const rescheduleBookingSchema = z.object({
  newStartAt: z.string().datetime({ offset: true, message: "New start time must be a valid ISO 8601 string" }),
  staffId: z.string().cuid("Invalid staff ID").optional(),
});

export const updateStatusSchema = z.object({
  status: z.enum(["CONFIRMED", "COMPLETED", "NO_SHOW"]),
});

export const cancelBookingSchema = z.object({
  /** Keep the deposit (client cancelled late). Otherwise a refund is flagged for the owner. */
  keepDeposit: z.boolean().default(false),
});

export const checkoutSchema = z
  .object({
    // Card is not accepted until the card terminal is integrated.
    method: z.enum(["CASH", "MPESA"]),
    /** Amount actually received now. Defaults to the full balance. */
    amount: z.number().int().min(0).optional(),
    discount: z.number().int().min(0).optional(),
    mpesaReceipt: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{10}$/, "M-Pesa receipt must be 10 letters/numbers")
      .optional(),
    notes: z.string().max(300).optional(),
  })
  .refine((d) => d.method !== "MPESA" || !!d.mpesaReceipt || d.amount === 0, {
    message: "Enter the M-Pesa confirmation code",
    path: ["mpesaReceipt"],
  });

export const listBookingsSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  staffId: z.string().optional(),
  clientId: z.string().optional(),
  status: z.enum(["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"]).optional(),
});

export type CreateBookingDto = z.infer<typeof createBookingSchema>;
export type RescheduleBookingDto = z.infer<typeof rescheduleBookingSchema>;
export type CheckoutDto = z.infer<typeof checkoutSchema>;
