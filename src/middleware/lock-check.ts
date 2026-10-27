import type { FastifyRequest } from "fastify";
import { AppError } from "../utils/errors";
import { prisma } from "../config/db";

/**
 * Lock Check Middleware
 * 
 * Prevents modification of finalized records (Cash-Ups, Payroll Runs).
 * It must be used on routes that update these specific entities, e.g.:
 * PATCH /api/payroll/:id
 * PATCH /api/cash-up/:id
 */
export async function lockCheck(req: FastifyRequest<{ Params: { id: string } }>) {
  const { id } = req.params;
  
  if (!id) {
    throw new AppError(400, "Record ID is required", "BAD_REQUEST");
  }

  // 1. Check if it's a locked PayrollRun
  if (req.url.includes("/payroll")) {
    const payroll = await prisma.payrollRun.findUnique({
      where: { id },
      select: { locked: true },
    });

    if (payroll?.locked) {
      throw new AppError(423, "This payroll run is locked and can no longer be modified.", "LOCKED");
    }
  }

  // 2. Check if it's a locked CashUp
  if (req.url.includes("/cash-up")) {
    const cashUp = await prisma.cashUp.findUnique({
      where: { id },
      select: { locked: true },
    });

    if (cashUp?.locked) {
      throw new AppError(423, "This cash-up is locked and can no longer be modified.", "LOCKED");
    }
  }
}