import type { FastifyRequest } from "fastify";
import { prisma } from "../config/db";
import { AppError } from "../utils/errors";

/**
 * Branch scope: decides which branch a staff request works on.
 *
 * Everyone works on their own branch. Someone allowed to switch branches (`canSwitchBranches`, e.g. an owner
 * overseeing both sides) can name another with the `x-branch-id` header; it is checked here, so a person who
 * is not allowed can never reach another branch's data by sending that header.
 *
 * Must run AFTER `authenticate`, which loads the person's own branch and permission.
 */
export async function branchScope(req: FastifyRequest) {
  if (!req.user || !req.user.branchId) {
    throw new AppError(401, "Unauthorized: No branch assigned to this session", "UNAUTHORIZED");
  }
  const home = req.user.homeBranchId ?? req.user.branchId;

  const header = req.headers["x-branch-id"];
  const requested = typeof header === "string" && header ? header : undefined;

  if (requested && requested !== home) {
    if (!req.user.canSwitchBranches) {
      throw new AppError(403, "Access denied: You can only access your assigned branch", "FORBIDDEN");
    }
    const target = await prisma.branch.findFirst({ where: { id: requested, isActive: true }, select: { id: true } });
    if (!target) throw new AppError(404, "That branch does not exist or is switched off", "NOT_FOUND");
    req.user.branchId = target.id;
  }

  // The branch always comes from the checks above, never from what the request body says.
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
    (req.body as Record<string, unknown>).branchId = req.user.branchId;
  }
}
