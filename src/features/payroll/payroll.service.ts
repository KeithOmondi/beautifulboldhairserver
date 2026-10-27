import { prisma } from "../../config/db";
import { AppError } from "../../utils/errors";
import type { GeneratePayrollDto, CreateAdjustmentDto } from "./payroll.schema";

export async function generatePayroll(branchId: string, data: GeneratePayrollDto) {
  const [yearStr, monthStr] = data.month.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr) - 1;

  const startDate = new Date(Date.UTC(year, month, 1, 12, 0, 0));
  const endDate = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59));

  // 1. Prevent duplicate runs
  const existingRun = await prisma.payrollRun.findFirst({
    where: {
      branchId,
      month: {
        gte: new Date(Date.UTC(year, month, 1, 0, 0, 0)),
        lte: new Date(Date.UTC(year, month, 1, 23, 59, 59)),
      },
    },
  });
  if (existingRun) {
    throw new AppError(409, "Payroll for this month already exists", "DUPLICATE_PAYROLL");
  }

  // 2. Fetch staff with overrides
  const staffMembers = await prisma.staff.findMany({
    where: { branchId, isActive: true },
    include: { overrides: true },
  });
  if (staffMembers.length === 0) {
    throw new AppError(400, "No active staff to run payroll for", "NO_STAFF");
  }

  // 3. Fetch completed + paid bookings in the month
  const bookings = await prisma.booking.findMany({
    where: {
      branchId,
      status: "COMPLETED",
      paid: true,
      startAt: { gte: startDate, lte: endDate },
    },
  });

  // 4. Calculate everything BEFORE the transaction
  const linesToCreate = staffMembers.map((staff) => {
    let totalCommission = 0;
    const salary = staff.monthlySalary || 0;

    if (staff.payType !== "SALARY_ONLY") {
      const staffBookings = bookings.filter((b) => b.staffId === staff.id);

      for (const booking of staffBookings) {
        const override = staff.overrides.find((o) => o.serviceId === booking.serviceId);
        const pct = override ? override.pct : staff.commissionPct || 0;
        const netPrice = booking.price - booking.discount;
        const commission = Math.floor((netPrice * pct) / 10000);
        totalCommission += commission;
      }
    }

    return {
      staffId: staff.id,
      salary,
      commission: totalCommission,
      finalAmount: salary + totalCommission,
    };
  });

  // 5. Create run + lines in one transaction
  const runId = await prisma.$transaction(async (tx) => {
    const payrollRun = await tx.payrollRun.create({
      data: { branchId, month: startDate, status: "DRAFT" },
    });

    for (const line of linesToCreate) {
      await tx.payrollLine.create({
        data: {
          payrollRunId: payrollRun.id,
          staffId: line.staffId,
          salary: line.salary,
          commission: line.commission,
          finalAmount: line.finalAmount,
        },
      });
    }

    return payrollRun.id;
  });

  // 6. Fetch the result with three simple queries joined in JS
  return fetchPayrollRun(runId);
}

async function fetchPayrollRun(runId: string) {
  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      branchId: true,
      month: true,
      status: true,
      approvedBy: true,
      approvedAt: true,
      paidAt: true,
      locked: true,
      createdAt: true,
    },
  });

  if (!run) return null;

  const lines = await prisma.payrollLine.findMany({
    where: { payrollRunId: runId },
    select: {
      id: true,
      staffId: true,
      salary: true,
      commission: true,
      finalAmount: true,
    },
  });

  const staffIds = lines.map((l) => l.staffId);
  const staffList = await prisma.staff.findMany({
    where: { id: { in: staffIds } },
    select: { id: true, name: true, role: true },
  });
  const staffMap = new Map(staffList.map((s) => [s.id, s]));

  const adjustments = await prisma.payrollAdjustment.findMany({
    where: { payrollLineId: { in: lines.map((l) => l.id) } },
  });
  const adjByLine = new Map<string, typeof adjustments>();
  for (const adj of adjustments) {
    if (!adjByLine.has(adj.payrollLineId)) adjByLine.set(adj.payrollLineId, []);
    adjByLine.get(adj.payrollLineId)!.push(adj);
  }

  return {
    ...run,
    lines: lines.map((l) => ({
      ...l,
      staff: staffMap.get(l.staffId) ?? { id: l.staffId, name: "Unknown", role: "WORKER" },
      adjustments: adjByLine.get(l.id) ?? [],
    })),
  };
}

export async function listPayrollRuns(branchId: string) {
  const runs = await prisma.payrollRun.findMany({
    where: { branchId },
    orderBy: { month: "desc" },
  });

  const results = [];
  for (const run of runs) {
    const full = await fetchPayrollRun(run.id);
    if (full) results.push(full);
  }
  return results;
}

export async function addAdjustment(branchId: string, runId: string, data: CreateAdjustmentDto) {
  const run = await prisma.payrollRun.findFirst({
    where: { id: runId, branchId },
    include: { lines: true },
  });
  if (!run) throw new AppError(404, "Payroll run not found", "NOT_FOUND");
  if (run.locked) throw new AppError(400, "Payroll run is locked", "ALREADY_LOCKED");

  const line = run.lines.find((l) => l.staffId === data.staffId);
  if (!line) throw new AppError(404, "Staff member not found in this payroll run", "NOT_FOUND");

  let effectOnFinal = 0;
  if (data.type === "BONUS") effectOnFinal = data.amount;
  if (data.type === "ADVANCE" || data.type === "DEDUCTION") effectOnFinal = -data.amount;

  await prisma.$transaction(async (tx) => {
    await tx.payrollAdjustment.create({
      data: {
        payrollLineId: line.id,
        type: data.type,
        amount: data.amount,
        note: data.note ?? null,
      },
    });

    await tx.payrollLine.update({
      where: { id: line.id },
      data: { finalAmount: line.finalAmount + effectOnFinal },
    });
  });

  return fetchPayrollRun(runId);
}

export async function approvePayroll(branchId: string, runId: string, approvedBy: string) {
  const run = await prisma.payrollRun.findFirst({
    where: { id: runId, branchId },
  });
  if (!run) throw new AppError(404, "Payroll run not found", "NOT_FOUND");
  if (run.locked) throw new AppError(400, "Payroll run is already locked", "ALREADY_LOCKED");

  await prisma.payrollRun.update({
    where: { id: runId },
    data: {
      status: "APPROVED",
      locked: true,
      approvedBy,
      approvedAt: new Date(),
    },
  });

  return fetchPayrollRun(runId);
}