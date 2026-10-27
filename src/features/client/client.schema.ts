import { z } from "zod";

// A strict Kenyan phone regex.
// Accepts formats like: 0712345678, +254712345678, 254712345678, 0112345678
const kenyanPhoneRegex = /^(?:\+?254|0)([17]\d{8})$/;

export const createClientSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").trim(),
  phone: z.string().regex(kenyanPhoneRegex, "Invalid Kenyan phone number (e.g., 0712345678)"),
  allergies: z.string().optional(),
  isFirstLash: z.boolean().default(true),
});

export const updateClientSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").trim().optional(),
  phone: z.string().regex(kenyanPhoneRegex, "Invalid Kenyan phone number").optional(),
  allergies: z.string().nullable().optional(),
  isFirstLash: z.boolean().optional(),
  isBlocked: z.boolean().optional(),
});

export type CreateClientDto = z.infer<typeof createClientSchema>;
export type UpdateClientDto = z.infer<typeof updateClientSchema>;