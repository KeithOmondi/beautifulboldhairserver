import { prisma } from "../../config/db";
import { AppError } from "../../utils/errors";
import type { 
  CreateShiftDto, 
  CreateRecurringShiftDto, 
  CreateBreakDto, 
  UpdateShiftDto 
} from "./shift.schema";

/**
 * Lists all shifts for a specific staff member within a date range.
 */
export async function listShifts(staffId: string, branchId: string, fromDate?: string, toDate?: string) {
  // Verify staff belongs to this branch
  const staff = await prisma.staff.findFirst({ where: { id: staffId, branchId } });
  if (!staff) throw new AppError(404, "Staff member not found", "NOT_FOUND");

  const whereClause: any = { staffId };

  if (fromDate || toDate) {
    whereClause.startAt = {};
    if (fromDate) whereClause.startAt.gte = new Date(fromDate);
    if (toDate) whereClause.startAt.lte = new Date(toDate);
  }

  return prisma.shift.findMany({
    where: whereClause,
    include: { breaks: true },
    orderBy: { startAt: "asc" },
  });
}

/**
 * Creates a single shift for a staff member.
 */
export async function createShift(branchId: string, data: CreateShiftDto) {
  // 1. Verify staff belongs to this branch
  const staff = await prisma.staff.findFirst({ where: { id: data.staffId, branchId } });
  if (!staff) throw new AppError(404, "Staff member not found", "NOT_FOUND");

  const startAt = new Date(data.startAt);
  const endAt = new Date(data.endAt);

  // 2. Check for overlapping shifts
  const overlappingShift = await prisma.shift.findFirst({
    where: {
      staffId: data.staffId,
      OR: [
        { startAt: { lt: endAt }, endAt: { gt: startAt } }, // Standard overlap check
      ],
    },
  });

  if (overlappingShift) {
    throw new AppError(409, "This staff member already has a shift during this time", "SHIFT_OVERLAP");
  }

  // 3. Create the shift
  return prisma.shift.create({
    data: {
      branchId,
      staffId: data.staffId,
      startAt,
      endAt,
      notes: data.notes ?? null,
    },
    include: { breaks: true },
  });
}

/**
 * Bulk-generates recurring weekly shifts.
 * e.g., "Every Monday from 09:00 to 18:00 for the next 4 weeks"
 */
export async function createRecurringShifts(branchId: string, data: CreateRecurringShiftDto) {
  // 1. Verify staff belongs to this branch
  const staff = await prisma.staff.findFirst({ where: { id: data.staffId, branchId } });
  if (!staff) throw new AppError(404, "Staff member not found", "NOT_FOUND");

  const shiftsToCreate = [];
  const today = new Date();
  
  // 2. Calculate the first date matching the requested day of week
  let currentDate = new Date(today);
  while (currentDate.getDay() !== data.dayOfWeek) {
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // 3. Loop through the requested number of weeks
  for (let week = 0; week < data.repeatWeeks; week++) {
    // FIX: TS strictness (noUncheckedIndexedAccess)
    const startParts = data.startTime.split(":");
    const startHour = Number(startParts[0]!);
    const startMinute = Number(startParts[1]!);

    const endParts = data.endTime.split(":");
    const endHour = Number(endParts[0]!);
    const endMinute = Number(endParts[1]!);

    const startAt = new Date(currentDate);
    startAt.setHours(startHour, startMinute, 0, 0);

    const endAt = new Date(currentDate);
    endAt.setHours(endHour, endMinute, 0, 0);

    // 4. Check for overlaps for this specific day
    const overlappingShift = await prisma.shift.findFirst({
      where: {
        staffId: data.staffId,
        OR: [{ startAt: { lt: endAt }, endAt: { gt: startAt } }],
      },
    });

    if (!overlappingShift) {
      shiftsToCreate.push({
        branchId,
        staffId: data.staffId,
        startAt,
        endAt,
      });
    }

    // Move to the same day next week
    currentDate.setDate(currentDate.getDate() + 7);
  }

  if (shiftsToCreate.length === 0) {
    throw new AppError(409, "All requested shifts overlap with existing shifts", "ALL_OVERLAP");
  }

  // 5. Bulk insert
  await prisma.shift.createMany({
    data: shiftsToCreate,
  });

  return { message: `Created ${shiftsToCreate.length} recurring shifts` };
}

/**
 * Adds a break to an existing shift (e.g., Lunch 13:00 - 14:00).
 */
export async function addBreak(branchId: string, shiftId: string, data: CreateBreakDto) {
  const shift = await prisma.shift.findFirst({ 
    where: { id: shiftId, branchId },
    include: { breaks: true }
  });
  
  if (!shift) throw new AppError(404, "Shift not found", "NOT_FOUND");

  const breakStart = new Date(data.startAt);
  const breakEnd = new Date(data.endAt);

  // 1. Ensure the break is strictly inside the shift
  if (breakStart < shift.startAt || breakEnd > shift.endAt) {
    throw new AppError(400, "Break must be within the shift's start and end time", "INVALID_BREAK");
  }

  // 2. Check for overlapping breaks within the same shift
  const overlappingBreak = shift.breaks.find((b) => {
    return breakStart < b.endAt && breakEnd > b.startAt;
  });

  if (overlappingBreak) {
    throw new AppError(409, "This break overlaps with an existing break", "BREAK_OVERLAP");
  }

  return prisma.break.create({
    data: {
      shiftId,
      startAt: breakStart,
      endAt: breakEnd,
    },
  });
}

/**
 * Updates an existing shift.
 */
export async function updateShift(branchId: string, shiftId: string, data: UpdateShiftDto) {
  const shift = await prisma.shift.findFirst({ where: { id: shiftId, branchId } });
  if (!shift) throw new AppError(404, "Shift not found", "NOT_FOUND");

  const startAt = data.startAt ? new Date(data.startAt) : shift.startAt;
  const endAt = data.endAt ? new Date(data.endAt) : shift.endAt;

  // Check overlaps if times changed
  if (data.startAt || data.endAt) {
    const overlappingShift = await prisma.shift.findFirst({
      where: {
        staffId: shift.staffId,
        id: { not: shiftId }, // Exclude current shift
        OR: [{ startAt: { lt: endAt }, endAt: { gt: startAt } }],
      },
    });

    if (overlappingShift) {
      throw new AppError(409, "Updated times overlap with another shift", "SHIFT_OVERLAP");
    }
  }

  // FIX: exactOptionalPropertyTypes
  const updateData: any = { startAt, endAt };
  if (data.notes !== undefined) {
    updateData.notes = data.notes;
  }

  return prisma.shift.update({
    where: { id: shiftId },
    data: updateData,
    include: { breaks: true },
  });
}

/**
 * Deletes a shift (and its breaks via Cascade).
 */
export async function deleteShift(branchId: string, shiftId: string) {
  const shift = await prisma.shift.findFirst({ where: { id: shiftId, branchId } });
  if (!shift) throw new AppError(404, "Shift not found", "NOT_FOUND");

  await prisma.shift.delete({ where: { id: shiftId } });
  return { message: "Shift deleted successfully" };
}