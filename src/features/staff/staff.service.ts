import { randomBytes } from "node:crypto";
import { prisma } from "../../config/db";
import { AppError } from "../../utils/errors";
import { hashPassword } from "../../utils/password";
import { normalizePhone } from "../../utils/phone";
import type { Role } from "../../generated/prisma/client";
import type { CreateStaffDto, UpdateStaffDto } from "./staff.schema";

const select = {
  id: true, name: true, email: true, phone: true, role: true, title: true, canSwitchBranches: true,
  isActive: true, isBookable: true, weeklyHours: true,
  payType: true, monthlySalary: true, commissionPct: true, createdAt: true,
  services: { select: { serviceId: true } },
} as const;

/**
 * Owners look after everyone. Managers look after front-desk staff and stylists only: they cannot create, edit,
 * reset or switch off other managers or owners, so no one can promote themselves or take over a peer's account.
 */
function assertCanAssign(actorRole: Role, target: Role) {
  if (actorRole === "OWNER") return;
  if (actorRole === "MANAGER" && (target === "RECEPTIONIST" || target === "WORKER")) return;
  throw new AppError(403, "Only an owner can create or change managers and owners", "FORBIDDEN");
}

const PAY_FIELDS = ["payType", "monthlySalary", "commissionPct"] as const;
/** Pay details are removed from what someone who may not see pay receives. */
export function withoutPay<T extends Record<string, unknown>>(row: T): Omit<T, (typeof PAY_FIELDS)[number]> {
  const copy = { ...row };
  for (const k of PAY_FIELDS) delete copy[k];
  return copy;
}

const withServiceIds = <T extends { services: Array<{ serviceId: string }> }>(s: T) => {
  const { services, ...rest } = s;
  return { ...rest, serviceIds: services.map((x) => x.serviceId) };
};

async function assertServicesInBranch(branchId: string, serviceIds: string[]) {
  if (!serviceIds.length) return;
  const n = await prisma.service.count({ where: { branchId, id: { in: serviceIds } } });
  if (n !== new Set(serviceIds).size) throw new AppError(400, "One of the selected services does not exist", "BAD_REQUEST");
}

export async function listStaff(branchId: string) {
  const rows = await prisma.staff.findMany({ where: { branchId }, select, orderBy: [{ isActive: "desc" }, { createdAt: "asc" }] });
  return rows.map(withServiceIds);
}

/** Everyone across all branches, each tagged with their branch (owner overview). */
export async function listAllStaff() {
  const rows = await prisma.staff.findMany({
    select: { ...select, branchId: true, branch: { select: { name: true, city: true } } },
    orderBy: [{ branch: { sortOrder: "asc" } }, { isActive: "desc" }, { createdAt: "asc" }],
  });
  return rows.map(({ branch, ...r }) => ({ ...withServiceIds(r), branchName: branch.city ?? branch.name }));
}

/** Only an owner who manages all branches may put someone in (or move them to) a branch other than the one being worked on. */
async function resolveBranch(current: string, chosen: string | undefined, actorRole: Role, actorSpans: boolean) {
  if (!chosen || chosen === current) return current;
  if (!(actorRole === "OWNER" && actorSpans)) throw new AppError(403, "You can only add or move people within your own branch", "FORBIDDEN");
  const b = await prisma.branch.findFirst({ where: { id: chosen, isActive: true }, select: { id: true } });
  if (!b) throw new AppError(404, "That branch does not exist or is switched off", "NOT_FOUND");
  return b.id;
}

export async function createStaff(activeBranchId: string, data: CreateStaffDto, actorRole: Role, actorSpans = false, canSetPay = actorRole === "OWNER") {
  const branchId = await resolveBranch(activeBranchId, data.staffBranchId, actorRole, actorSpans);
  // Someone who may not see pay cannot set it either: the new person starts on the defaults.
  if (!canSetPay) data = { ...data, payType: "SALARY_ONLY" } as CreateStaffDto;
  assertCanAssign(actorRole, data.role);
  if (data.canSwitchBranches && !(actorRole === "OWNER" && actorSpans)) throw new AppError(403, "Only an owner who manages all branches can let someone work across branches", "FORBIDDEN");

  const phone = normalizePhone(data.phone);
  if (!phone) throw new AppError(400, "Invalid Kenyan phone number", "INVALID_PHONE");
  const email = data.email.trim().toLowerCase();

  await assertServicesInBranch(branchId, data.serviceIds ?? []);
  const exists = await prisma.staff.findFirst({ where: { OR: [{ email }, { phone }] } });
  if (exists) throw new AppError(409, "Email or phone already in use", "DUPLICATE_STAFF");

  // Never a shared default password: generate one the owner hands over, forced to change on first login.
  const temporaryPassword = data.password ?? randomBytes(6).toString("base64url");

  const staff = await prisma.staff.create({
    data: {
      branchId,
      name: data.name,
      email,
      phone,
      passwordHash: await hashPassword(temporaryPassword),
      role: data.role,
      canSwitchBranches: Boolean(data.canSwitchBranches),
      title: data.title ?? null,
      isBookable: data.isBookable,
      ...(data.weeklyHours ? { weeklyHours: data.weeklyHours } : {}),
      payType: data.payType,
      monthlySalary: canSetPay ? (data.monthlySalary ?? null) : null,
      commissionPct: canSetPay ? (data.commissionPct ?? null) : null,
      mustChangePassword: true,
      ...(data.serviceIds?.length ? { services: { create: data.serviceIds.map((serviceId) => ({ serviceId })) } } : {}),
    },
    select,
  });

  return { ...(canSetPay ? withServiceIds(staff) : withoutPay(withServiceIds(staff))), temporaryPassword };
}

export async function updateStaff(branchId: string, id: string, data: UpdateStaffDto, actorRole: Role, actorId: string, actorSpans = false, canSetPay = actorRole === "OWNER") {
  const moveTo = await resolveBranch(branchId, data.staffBranchId, actorRole, actorSpans);
  if (data.canSwitchBranches !== undefined && !(actorRole === "OWNER" && actorSpans)) throw new AppError(403, "Only an owner who manages all branches can change this", "FORBIDDEN");
  if (id === actorId && data.canSwitchBranches === false) throw new AppError(400, "You cannot take away your own access to other branches", "BAD_REQUEST");
  const staff = await prisma.staff.findFirst({ where: { id, branchId } });
  if (!staff) throw new AppError(404, "Staff member not found", "NOT_FOUND");

  assertCanAssign(actorRole, staff.role); // you can only change people you are allowed to look after
  if (data.role !== undefined) assertCanAssign(actorRole, data.role);
  if (id === actorId && (data.isActive === false || (data.role !== undefined && data.role !== staff.role))) {
    throw new AppError(400, "You cannot deactivate or demote your own account", "BAD_REQUEST");
  }

  const updateData: Record<string, unknown> = {};
  for (const key of ["name", "role", "title", "isActive", "isBookable", "payType", "monthlySalary", "commissionPct", "canSwitchBranches"] as const) {
    if ((PAY_FIELDS as readonly string[]).includes(key) && !canSetPay) continue; // pay is not theirs to change
    if (data[key] !== undefined) updateData[key] = data[key];
  }
  if (data.weeklyHours !== undefined) updateData.weeklyHours = data.weeklyHours === null ? null : data.weeklyHours;

  if (data.phone !== undefined) {
    const phone = normalizePhone(data.phone);
    if (!phone) throw new AppError(400, "Invalid Kenyan phone number", "INVALID_PHONE");
    const taken = await prisma.staff.findFirst({ where: { phone, id: { not: id } } });
    if (taken) throw new AppError(409, "That phone number is already in use", "DUPLICATE_STAFF");
    updateData.phone = phone;
  }

  if (moveTo !== branchId) {
    if (id === actorId) throw new AppError(400, "You cannot move your own account to another branch", "BAD_REQUEST");
    const upcoming = await prisma.booking.count({ where: { staffId: id, startAt: { gte: new Date() }, status: { notIn: ["CANCELLED", "NO_SHOW", "COMPLETED"] } } });
    if (upcoming > 0) throw new AppError(409, `${staff.name} has ${upcoming} upcoming booking${upcoming === 1 ? "" : "s"}. Reassign or cancel them before moving to another branch.`, "HAS_BOOKINGS");
    updateData.branchId = moveTo;
    // Services belong to a branch, so the old links no longer apply.
    updateData.services = { deleteMany: {} };
  }

  if (data.serviceIds) {
    await assertServicesInBranch(moveTo, data.serviceIds);
    updateData.services = { deleteMany: {}, create: data.serviceIds.map((serviceId) => ({ serviceId })) };
  }

  const updated = withServiceIds(await prisma.staff.update({ where: { id }, data: updateData, select }));
  return canSetPay ? updated : withoutPay(updated);
}

export async function resetStaffPassword(branchId: string, id: string, actorRole: Role) {
  const staff = await prisma.staff.findFirst({ where: { id, branchId } });
  if (!staff) throw new AppError(404, "Staff member not found", "NOT_FOUND");
  assertCanAssign(actorRole, staff.role);

  const temporaryPassword = randomBytes(6).toString("base64url");
  await prisma.staff.update({
    where: { id },
    data: { passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true },
  });
  return { temporaryPassword };
}

export async function deactivateStaff(branchId: string, id: string, actorId: string, actorRole: Role = "OWNER") {
  if (id === actorId) throw new AppError(400, "You cannot deactivate your own account", "BAD_REQUEST");
  const staff = await prisma.staff.findFirst({ where: { id, branchId } });
  if (!staff) throw new AppError(404, "Staff member not found", "NOT_FOUND");
  assertCanAssign(actorRole, staff.role);
  await prisma.staff.update({ where: { id }, data: { isActive: false } });
  return { message: "Staff member deactivated successfully" };
}
