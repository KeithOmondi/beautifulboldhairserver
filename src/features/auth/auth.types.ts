import type { Role } from "../../generated/prisma/client";

/**
 * The payload for the short-lived Access Token.
 * This is what gets attached to `req.user` everywhere in the app.
 */
export interface AuthUser {
  sub: string; // staff id
  role: Role;
  /** The branch this request works on: the person's own, or the one they switched to. */
  branchId: string;
  /** The person's own branch (never changes with switching). */
  homeBranchId?: string;
  canSwitchBranches?: boolean;
}

/**
 * The payload for the long-lived Refresh Token.
 * It only contains the user ID and a type flag so we know it's a refresh token.
 */
export interface RefreshTokenPayload {
  sub: string;
  type: "refresh";
}

// Gives req.user and jwtSign a real type everywhere.
declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}