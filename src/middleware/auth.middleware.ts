import type { FastifyRequest } from "fastify";
import { AppError } from "../utils/errors";
import { prisma } from "../config/db";

export async function authenticate(req: FastifyRequest) {
  try {
    // 1. Verify the JWT from the COOKIE, not the header
    await req.jwtVerify({ 
      onlyCookie: true // <--- Tells Fastify to look in req.cookies for the token
    });
  } catch (err: any) {
    // Give the frontend a specific error if the token is just expired
    if (err.code === "FAST_JWT_EXPIRED") {
      throw new AppError(401, "Your session has expired. Please log in again.", "TOKEN_EXPIRED");
    }
    throw new AppError(401, "Please log in", "UNAUTHORIZED");
  }

  // A refresh token must never work as an access token.
  if ((req.user as unknown as { type?: string }).type === "refresh") {
    throw new AppError(401, "Please log in", "UNAUTHORIZED");
  }

  // 2. Verify the user still exists and is active in the database
  const staff = await prisma.staff.findUnique({
    where: { id: req.user.sub },
    select: { id: true, isActive: true, role: true, branchId: true, canSwitchBranches: true, department: true },
  });

  if (!staff) {
    throw new AppError(401, "Account no longer exists", "UNAUTHORIZED");
  }
  
  if (!staff.isActive) {
    throw new AppError(403, "Your account has been disabled", "ACCOUNT_DISABLED");
  }

  // 3. Sync the token with the database
  req.user.role = staff.role;
  req.user.branchId = staff.branchId;
  req.user.homeBranchId = staff.branchId;
  req.user.canSwitchBranches = staff.canSwitchBranches;
  req.user.department = staff.department;
}