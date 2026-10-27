import { prisma } from "../../config/db";
import { AppError } from "../../utils/errors";
import type { CreateCashUpDto } from "./cash-up.schema";

export async function createCashUp(branchId: string, data: CreateCashUpDto) {
  const businessDate = new Date(`${data.businessDate}T00:00:00+03:00`);
  const dayEnd = new Date(`${data.businessDate}T23:59:59+03:00`);

  // 1. Check if a cash-up already exists for this date
  const existing = await prisma.cashUp.findFirst({
    where: { branchId, businessDate },
  });
  if (existing) throw new AppError(409, "A cash-up already exists for this date", "DUPLICATE_CASHUP");

  // 2. Calculate Expected Cash (CASH payments only)
  const payments = await prisma.payment.findMany({
    where: {
      branchId,
      method: "CASH",
      createdAt: { gte: businessDate, lte: dayEnd },
    },
  });

  const expectedCash = payments.reduce((sum, p) => sum + p.amount, 0);
  const difference = data.countedCash - expectedCash;

  // 3. Create the cash-up record
  return prisma.cashUp.create({
    data: {
      branchId,
      businessDate,
      expectedCash,
      countedCash: data.countedCash,
      difference,
      notes: data.notes ?? null, // FIX: undefined -> null
      locked: false,
    },
  });
}

export async function listCashUps(branchId: string) {
  return prisma.cashUp.findMany({
    where: { branchId },
    orderBy: { businessDate: "desc" },
    take: 30,
  });
}

export async function approveCashUp(branchId: string, cashUpId: string, approvedBy: string) {
  const cashUp = await prisma.cashUp.findFirst({
    where: { id: cashUpId, branchId },
  });

  if (!cashUp) throw new AppError(404, "Cash-up not found", "NOT_FOUND");
  if (cashUp.locked) throw new AppError(400, "Cash-up is already locked", "ALREADY_LOCKED");

  return prisma.cashUp.update({
    where: { id: cashUpId },
    data: {
      locked: true,
      approvedBy,
      approvedAt: new Date(),
    },
  });
}