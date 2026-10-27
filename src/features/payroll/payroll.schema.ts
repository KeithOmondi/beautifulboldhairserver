import { z } from "zod";
import { AdjustmentType } from "../../generated/prisma/client";

const adjustmentTypeEnum = z.nativeEnum(AdjustmentType);

export const generatePayrollSchema = z.object({
  // Enforces "YYYY-MM" format (e.g., "2026-10")
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be in YYYY-MM format"),
});

export const createAdjustmentSchema = z.object({
  staffId: z.string().cuid("Invalid staff ID"),
  type: adjustmentTypeEnum,
  // Amounts must be positive integers (e.g., 500 for 500 KES).
  // The 'type' (ADVANCE, DEDUCTION, BONUS) determines if it's added or subtracted.
  amount: z.number().int().positive("Adjustment amount must be greater than zero"),
  note: z.string().optional(),
});

export type GeneratePayrollDto = z.infer<typeof generatePayrollSchema>;
export type CreateAdjustmentDto = z.infer<typeof createAdjustmentSchema>;