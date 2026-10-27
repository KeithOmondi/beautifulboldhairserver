import type { 
  PayrollRun, 
  PayrollLine, 
  PayrollAdjustment, 
  PayrollStatus,
  AdjustmentType
} from "../../generated/prisma/client";

/**
 * Input for generating a new payroll run.
 */
export interface GeneratePayrollInput {
  month: string; // Format: "YYYY-MM" (e.g., "2026-10")
}

/**
 * The calculated commission for a specific worker.
 * This is used internally by the Payroll Engine before saving.
 */
export interface WorkerCommissionCalculation {
  staffId: string;
  staffName: string;
  baseSalary: number;
  totalCommission: number;
  finalAmount: number;
  bookingDetails: {
    bookingId: string;
    serviceName: string;
    totalPrice: number;
    commissionAmount: number;
    commissionPercentage: number;
  }[];
}

/**
 * Input for adding an adjustment (Advance, Deduction, or Bonus).
 */
export interface CreateAdjustmentInput {
  staffId: string;
  type: AdjustmentType;
  amount: number;
  note?: string;
}

/**
 * A full payroll run with all its lines and adjustments.
 * Used when the Owner opens the "Payroll Summary" screen.
 */
export type PayrollRunWithDetails = PayrollRun & {
  lines: (PayrollLine & {
    staff: { name: string; role: string };
    adjustments: PayrollAdjustment[];
  })[];
};