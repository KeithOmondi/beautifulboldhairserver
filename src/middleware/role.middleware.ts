import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../utils/errors";
import type { Role } from "../generated/prisma/client";

export function authorize(...allowedRoles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    // req.user is guaranteed to exist because `authenticate` runs first
    if (!req.user) {
      throw new AppError(401, "Not authenticated", "UNAUTHORIZED");
    }

    if (!allowedRoles.includes(req.user.role)) {
      throw new AppError(
        403,
        `Access denied. Requires one of: ${allowedRoles.join(", ")}`,
        "FORBIDDEN"
      );
    }
  };
}