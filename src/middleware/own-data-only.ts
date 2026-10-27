import type { FastifyRequest } from "fastify";
import { AppError } from "../utils/errors";

/**
 * Own Data Only Middleware
 * 
 * Ensures that a WORKER can only access their own records.
 * OWNER and MANAGER roles bypass this check.
 * 
 * Usage:
 * Apply this to routes where a `:staffId` or `:id` param represents the staff member.
 * Example: GET /api/staff/:id/payroll
 */
export async function ownDataOnly(req: FastifyRequest<{ Params: { id?: string; staffId?: string } }>) {
  if (!req.user) {
    throw new AppError(401, "Not authenticated", "UNAUTHORIZED");
  }

  // OWNER and MANAGER can view anyone's data
  if (req.user.role === "OWNER" || req.user.role === "MANAGER") {
    return;
  }

  // Determine which parameter holds the staff ID.
  // If the route is /staff/:id, we use req.params.id. 
  // If it's /bookings?staffId=..., we might need to check query/body, but params are safest.
  const targetStaffId = req.params.staffId || req.params.id;

  if (!targetStaffId) {
    // If there's no ID in the URL, the controller is likely returning "my data" anyway
    // (e.g., GET /api/staff/me). We let it pass.
    return;
  }

  // If a WORKER is trying to access someone else's ID, block them.
  if (req.user.sub !== targetStaffId) {
    throw new AppError(403, "Access denied: You can only view your own records", "FORBIDDEN");
  }
}