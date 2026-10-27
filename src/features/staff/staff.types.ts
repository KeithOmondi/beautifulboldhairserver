import type { Role, PayType } from "../../generated/prisma/client";

export interface CreateStaffInput {
  name: string;
  email: string;
  phone: string;
  password?: string; // Optional: we can auto-generate one
  role: Role;
  payType?: PayType;
  monthlySalary?: number;
  commissionPct?: number;
}

export interface UpdateStaffInput {
  name?: string;
  phone?: string;
  role?: Role;
  isActive?: boolean;
  payType?: PayType;
  monthlySalary?: number | null;
  commissionPct?: number | null;
}