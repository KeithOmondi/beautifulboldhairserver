import { prisma } from "../../config/db";
import { AppError } from "../../utils/errors";
import { hashPassword } from "../../utils/password";
import { normalizePhone } from "../../utils/phone";
import type { CreateStaffDto, UpdateStaffDto } from "./staff.schema";

export async function listStaff(branchId: string) {
  return prisma.staff.findMany({
    where: { branchId },
    select: {
      id: true, name: true, email: true, phone: true,
      role: true, isActive: true, payType: true,
      monthlySalary: true, commissionPct: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function createStaff(branchId: string, data: CreateStaffDto) {
  const phone = normalizePhone(data.phone);
  if (!phone) throw new AppError(400, "Invalid Kenyan phone number", "INVALID_PHONE");

  // Check for duplicates
  const exists = await prisma.staff.findFirst({
    where: { OR: [{ email: data.email }, { phone }] },
  });
  if (exists) throw new AppError(409, "Email or phone already in use", "DUPLICATE_STAFF");

  // Use provided password or generate a default one
  const plainPassword = data.password || "Welcome123!";
  const passwordHash = await hashPassword(plainPassword);

  const staff = await prisma.staff.create({
    data: {
      branchId,
      name: data.name,
      email: data.email.toLowerCase(),
      phone,
      passwordHash,
      role: data.role,
      payType: data.payType,
      // FIX: exactOptionalPropertyTypes requires null instead of undefined
      monthlySalary: data.monthlySalary ?? null,
      commissionPct: data.commissionPct ?? null,
      mustChangePassword: true,
    },
    select: {
      id: true, name: true, email: true, phone: true,
      role: true, isActive: true, payType: true,
      monthlySalary: true, commissionPct: true,
    },
  });

  return staff;
}

export async function updateStaff(branchId: string, id: string, data: UpdateStaffDto) {
  const staff = await prisma.staff.findFirst({ where: { id, branchId } });
  if (!staff) throw new AppError(404, "Staff member not found", "NOT_FOUND");

  // Build update object, handling exactOptionalPropertyTypes
  const updateData: any = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.role !== undefined) updateData.role = data.role;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;
  if (data.payType !== undefined) updateData.payType = data.payType;
  if (data.monthlySalary !== undefined) updateData.monthlySalary = data.monthlySalary;
  if (data.commissionPct !== undefined) updateData.commissionPct = data.commissionPct;
  
  // Normalize phone if updated
  if (data.phone !== undefined) {
    const phone = normalizePhone(data.phone);
    if (!phone) throw new AppError(400, "Invalid Kenyan phone number", "INVALID_PHONE");
    updateData.phone = phone;
  }

  return prisma.staff.update({
    where: { id },
    data: updateData,
    select: {
      id: true, name: true, email: true, phone: true,
      role: true, isActive: true, payType: true,
      monthlySalary: true, commissionPct: true,
    },
  });
}

export async function deactivateStaff(branchId: string, id: string) {
  const staff = await prisma.staff.findFirst({ where: { id, branchId } });
  if (!staff) throw new AppError(404, "Staff member not found", "NOT_FOUND");

  await prisma.staff.update({ where: { id }, data: { isActive: false } });
  return { message: "Staff member deactivated successfully" };
}