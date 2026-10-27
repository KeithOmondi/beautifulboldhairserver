import type { FastifyRequest } from "fastify";
import { AppError } from "../utils/errors";

/**
 * Middleware for Public Client Routes.
 * Verifies the short-lived JWT given out after OTP verification.
 * Ensures a staff token cannot be used to access public booking routes.
 */
export async function authenticateClient(req: FastifyRequest) {
  try {
    await req.jwtVerify();
  } catch {
    throw new AppError(401, "Please verify your phone number to continue", "UNAUTHORIZED");
  }

  // Because we globally augment req.user as AuthUser (for staff),
  // we need to cast it to unknown first to check the public 'type' field.
  const user = req.user as unknown as { type: string };
  
  if (user.type !== "client") {
    throw new AppError(403, "Access denied: Staff tokens cannot be used for public booking", "FORBIDDEN");
  }
}