import type { Role } from "../../generated/prisma/client";

export interface AuthUser {
  sub: string; // staff id
  role: Role;
  branchId: string;
}

// Gives req.user and jwtSign a real type everywhere.
declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}