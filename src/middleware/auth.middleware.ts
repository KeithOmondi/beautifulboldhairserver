import type { FastifyRequest } from "fastify";
import { AppError } from "../utils/errors";
import { prisma } from "../config/db";

export async function authenticate(req: FastifyRequest) {
  try {
    // 1. Verify JWT signature and expiration
    await req.jwtVerify();
  } catch (err: any) {
    // Give the frontend a specific error if the token is just expired
    if (err.code === "FAST_JWT_EXPIRED") {
      throw new AppError(401, "Your session has expired. Please log in again.", "TOKEN_EXPIRED");
    }
    throw new AppError(401, "Please log in", "UNAUTHORIZED");
  }

  // 2. Verify the user still exists and is active in the database
  // This instantly blocks fired staff, even if their token hasn't expired yet.
  const staff = await prisma.staff.findUnique({
    where: { id: req.user.sub },
    select: { id: true, isActive: true, role: true, branchId: true },
  });

  if (!staff) {
    throw new AppError(401, "Account no longer exists", "UNAUTHORIZED");
  }
  
  if (!staff.isActive) {
    throw new AppError(403, "Your account has been disabled", "ACCOUNT_DISABLED");
  }

  // 3. Sync the token with the database
  // If an admin changes their role or branch, it updates immediately.
  req.user.role = staff.role;
  req.user.branchId = staff.branchId;
}