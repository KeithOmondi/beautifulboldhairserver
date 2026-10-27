import { z } from "zod";

export const createServiceSchema = z.object({
  name: z.string().min(2, "Service name must be at least 2 characters").trim(),
  durationMin: z.number().int().positive("Duration must be a positive number of minutes"),
  price: z.number().int().nonnegative("Price cannot be negative"), // Whole shillings only
  requiresPatchTest: z.boolean().default(false),
  isWigService: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const updateServiceSchema = z.object({
  name: z.string().min(2, "Service name must be at least 2 characters").trim().optional(),
  durationMin: z.number().int().positive("Duration must be a positive number of minutes").optional(),
  price: z.number().int().nonnegative("Price cannot be negative").optional(),
  requiresPatchTest: z.boolean().optional(),
  isWigService: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const createCommissionOverrideSchema = z.object({
  staffId: z.string().cuid("Invalid staff ID"),
  serviceId: z.string().cuid("Invalid service ID"),
  pct: z.number().int().min(0).max(10000), // Basis points (e.g., 1500 = 15.00%)
});

// Export types
export type CreateServiceDto = z.infer<typeof createServiceSchema>;
export type UpdateServiceDto = z.infer<typeof updateServiceSchema>;
export type CreateCommissionOverrideDto = z.infer<typeof createCommissionOverrideSchema>;