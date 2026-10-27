import type { FastifyRequest } from "fastify";
import { AppError } from "../utils/errors";

/**
 * Branch Scope Middleware
 * 
 * Ensures that a user only interacts with data from their assigned branch.
 * It extracts the branchId from the user's JWT (which was verified by `authenticate`)
 * and attaches it to the request.
 * 
 * Note: This must ALWAYS run AFTER the `authenticate` middleware, because it relies
 * on `req.user` being populated.
 */
export async function branchScope(req: FastifyRequest) {
  if (!req.user || !req.user.branchId) {
    throw new AppError(401, "Unauthorized: No branch assigned to this session", "UNAUTHORIZED");
  }

  // Check if the user is trying to explicitly request a different branch via query params
  // (e.g., ?branchId=some-other-branch)
  const requestedBranch = req.query as Record<string, string>;
  
  if (requestedBranch.branchId && requestedBranch.branchId !== req.user.branchId) {
    // If the user is an OWNER, they might be allowed to switch branches. 
    // If they are a MANAGER, RECEPTIONIST, or WORKER, they are strictly locked to their branch.
    if (req.user.role !== "OWNER") {
      throw new AppError(403, "Access denied: You can only access your assigned branch", "FORBIDDEN");
    }
    
    // If they are an OWNER, we allow them to scope to the requested branch.
    // We override req.user.branchId so the rest of the app uses the requested branch.
    req.user.branchId = requestedBranch.branchId;
  }

  // Ensure the request body or params cannot override the branchId for non-owners.
  if (req.body && typeof req.body === "object") {
    const body = req.body as Record<string, any>;
    if (body.branchId && body.branchId !== req.user.branchId && req.user.role !== "OWNER") {
      throw new AppError(403, "Access denied: Cannot create/update records for another branch", "FORBIDDEN");
    }
    // Force the branchId to the user's branch to prevent malicious injection
    body.branchId = req.user.branchId;
  }
}