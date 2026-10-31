import { z } from "zod";
import { Role, PayType } from "../../generated/prisma/client";

const roleEnum = z.nativeEnum(Role);
const payTypeEnum = z.nativeEnum(PayType);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm");

// { "1": { start: "09:00", end: "18:00" }, "0": null } keyed by day of week, 0 = Sunday
export const weeklyHoursSchema = z.record(
  z.string().regex(/^[0-6]$/),
  z.object({ start: hhmm, end: hhmm }).refine((h) => h.end > h.start, "End must be after start").nullable(),
);

export const createStaffSchema = z.object({
  name: z.string().trim().min(2, "Name is too short"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(10, "Invalid phone number"),
  password: z.string().min(8, "Password must be at least 8 characters").optional(),
  role: roleEnum.default(Role.WORKER),
  /** Can work on other branches too. Only an owner who spans branches can grant this. */
  canSwitchBranches: z.boolean().optional(),
  /** Which branch they work at. Only an owner who manages all branches can pick one other than their own (named so the branch scope never overwrites it). */
  staffBranchId: z.string().min(1).optional(),
  title: z.string().trim().max(60).optional(),
  isBookable: z.boolean().default(true),
  /** Services this person performs. Empty / omitted = all services. */
  serviceIds: z.array(z.string().cuid()).optional(),
  weeklyHours: weeklyHoursSchema.optional(),
  payType: payTypeEnum.default(PayType.SALARY_ONLY),
  monthlySalary: z.number().int().nonnegative().optional(),
  commissionPct: z.number().int().min(0).max(10000).optional(), // basis points: 1250 = 12.50%
});

export const updateStaffSchema = z.object({
  name: z.string().trim().min(2).optional(),
  phone: z.string().min(10).optional(),
  role: roleEnum.optional(),
  canSwitchBranches: z.boolean().optional(),
  /** Move them to another branch. Owner-only. */
  staffBranchId: z.string().min(1).optional(),
  title: z.string().trim().max(60).nullable().optional(),
  isActive: z.boolean().optional(),
  isBookable: z.boolean().optional(),
  serviceIds: z.array(z.string().cuid()).optional(),
  weeklyHours: weeklyHoursSchema.nullable().optional(),
  payType: payTypeEnum.optional(),
  monthlySalary: z.number().int().nonnegative().nullable().optional(),
  commissionPct: z.number().int().min(0).max(10000).nullable().optional(),
});

export type CreateStaffDto = z.infer<typeof createStaffSchema>;
export type UpdateStaffDto = z.infer<typeof updateStaffSchema>;
