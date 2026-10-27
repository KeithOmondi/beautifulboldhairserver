import { z } from "zod";
import { Role, PayType } from "../../generated/prisma/client";

// Helper to handle Prisma Enums in Zod
const roleEnum = z.nativeEnum(Role);
const payTypeEnum = z.nativeEnum(PayType);

export const createStaffSchema = z.object({
  name: z.string().min(2, "Name is too short"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(10, "Invalid phone number"),
  password: z.string().min(8, "Password must be at least 8 characters").optional(),
  role: roleEnum.default(Role.WORKER),
  payType: payTypeEnum.default(PayType.SALARY_ONLY),
  monthlySalary: z.number().int().nonnegative().optional(),
  commissionPct: z.number().int().min(0).max(10000).optional(), // e.g. 1250 = 12.50%
});

export const updateStaffSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().min(10).optional(),
  role: roleEnum.optional(),
  isActive: z.boolean().optional(),
  payType: payTypeEnum.optional(),
  monthlySalary: z.number().int().nonnegative().nullable().optional(),
  commissionPct: z.number().int().min(0).max(10000).nullable().optional(),
});

export type CreateStaffDto = z.infer<typeof createStaffSchema>;
export type UpdateStaffDto = z.infer<typeof updateStaffSchema>;