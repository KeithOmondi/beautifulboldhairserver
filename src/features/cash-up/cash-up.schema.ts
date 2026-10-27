import { z } from "zod";

export const createCashUpSchema = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  countedCash: z.number().int().nonnegative("Counted cash cannot be negative"),
  notes: z.string().optional(),
});

export type CreateCashUpDto = z.infer<typeof createCashUpSchema>;