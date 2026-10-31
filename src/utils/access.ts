import type { FastifyRequest } from "fastify";
import { prisma } from "../config/db";
import { AppError } from "./errors";

/**
 * What a person may do beyond the basics of their role.
 *
 * Owners can do everything. Managers get only what the owner switches on for their branch (Settings, "What managers can do").
 * Everyone else never gets these: receptionists and stylists work with bookings and the till, not with refunds or pay.
 */
export type Capability = "reports" | "refunds" | "cashUp" | "staffPay";
export type Access = Record<Capability, boolean>;

const ALL: Access = { reports: true, refunds: true, cashUp: true, staffPay: true };
const NONE: Access = { reports: false, refunds: false, cashUp: false, staffPay: false };

/** The defaults before an owner changes anything: managers run the day, but money-moving and pay stay with the owner. */
export const MANAGER_DEFAULTS: Access = { reports: true, refunds: false, cashUp: true, staffPay: false };

export async function accessFor(user: { role: string; branchId: string }): Promise<Access> {
  if (user.role === "OWNER") return ALL;
  if (user.role !== "MANAGER") return NONE;
  const s = await prisma.bookingSettings.findUnique({ where: { branchId: user.branchId }, select: { mgrReports: true, mgrRefunds: true, mgrCashUp: true, mgrStaffPay: true } });
  if (!s) return MANAGER_DEFAULTS;
  return { reports: s.mgrReports, refunds: s.mgrRefunds, cashUp: s.mgrCashUp, staffPay: s.mgrStaffPay };
}

const WHY: Record<Capability, string> = {
  reports: "Sales reports and revenue are only for owners, unless the owner allows managers to see them",
  refunds: "Only the owner can refund payments or clear unmatched M-Pesa payments",
  cashUp: "Only the owner can approve the end-of-day cash count",
  staffPay: "Staff pay is only for the owner",
};

/** A route guard: lets the request through only if the signed-in person holds this capability. */
export const requires = (cap: Capability) => async (req: FastifyRequest) => {
  if (!req.user) throw new AppError(401, "Not authenticated", "UNAUTHORIZED");
  const a = await accessFor(req.user);
  if (!a[cap]) throw new AppError(403, WHY[cap], "FORBIDDEN");
};
