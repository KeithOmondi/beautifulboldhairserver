import type { CashUp } from "../../generated/prisma/client";

export interface CreateCashUpInput {
  businessDate: string; // "YYYY-MM-DD"
  countedCash: number;  // What the receptionist actually counted
  notes?: string;
}

export interface CashUpSummary {
  id: string;
  businessDate: Date;
  expectedCash: number; // System calculated (cash payments only)
  countedCash: number;  // Manual input
  difference: number;   // countedCash - expectedCash
  locked: boolean;
  approvedBy: string | null;
  approvedAt: Date | null;
}

export type CashUpWithDetails = CashUp & {
  branch: { name: string };
};