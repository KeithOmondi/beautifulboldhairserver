import type { FastifyReply, FastifyRequest } from "fastify";
import { 
  loginSchema, 
  changePasswordSchema, 
  requestPasswordResetSchema, 
  resetPasswordSchema 
} from "./auth.schema";
import * as authService from "./auth.service";
import { clearTokens, sendToken } from "../../utils/sendToken";
import { AppError } from "../../utils/errors";
import type { RefreshTokenPayload } from "./auth.types";

export async function login(req: FastifyRequest, reply: FastifyReply) {
  const body = loginSchema.parse(req.body);
  const staff = await authService.verifyLogin(body.email, body.password);

  // Set HttpOnly cookies and return the user object
  sendToken(reply, {
    sub: staff.id,
    role: staff.role,
    branchId: staff.branchId,
  });

  return reply.send({
    user: {
      id: staff.id,
      name: staff.name,
      email: staff.email,
      role: staff.role,
      branchId: staff.branchId,
      canSwitchBranches: staff.canSwitchBranches,
      department: staff.department,
      mustChangePassword: staff.mustChangePassword,
    },
  });
}

export async function refresh(req: FastifyRequest, reply: FastifyReply) {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) {
      throw new AppError(401, "No refresh token provided", "UNAUTHORIZED");
    }

    const decoded = await req.server.jwt.verify<RefreshTokenPayload>(refreshToken);
    
    if (decoded.type !== "refresh") {
      throw new AppError(401, "Invalid token type", "UNAUTHORIZED");
    }

    const staff = await authService.getStaffProfile(decoded.sub);

    sendToken(reply, {
      sub: staff.id,
      role: staff.role,
      branchId: staff.branchId,
    });

    return reply.send({ message: "Token refreshed successfully" });
  } catch (error: any) {
    return reply.status(401).send({ message: "Session expired. Please log in again." });
  }
}

export async function logout(_req: FastifyRequest, reply: FastifyReply) {
  clearTokens(reply);
  return reply.send({ message: "Logged out" });
}

export async function me(req: FastifyRequest) {
  return authService.getStaffProfile(req.user.sub);
}

export async function changePassword(req: FastifyRequest, reply: FastifyReply) {
  const body = changePasswordSchema.parse(req.body);
  const result = await authService.changePassword(req.user.sub, body);
  return reply.send(result);
}

export async function requestPasswordReset(req: FastifyRequest, reply: FastifyReply) {
  const body = requestPasswordResetSchema.parse(req.body);
  const result = await authService.requestPasswordReset(body.email);
  return reply.send(result);
}

export async function resetPassword(req: FastifyRequest, reply: FastifyReply) {
  const body = resetPasswordSchema.parse(req.body);
  const result = await authService.resetPassword(body);
  return reply.send(result);
}