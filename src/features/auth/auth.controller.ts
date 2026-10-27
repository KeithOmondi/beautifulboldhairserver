import type { FastifyReply, FastifyRequest } from "fastify";
import { 
  loginSchema, 
  changePasswordSchema, 
  requestPasswordResetSchema, 
  resetPasswordSchema 
} from "./auth.schema";
import * as authService from "./auth.service";

export async function login(req: FastifyRequest, reply: FastifyReply) {
  const body = loginSchema.parse(req.body);
  const staff = await authService.verifyLogin(body.email, body.password);

  const token = await reply.jwtSign(
    { sub: staff.id, role: staff.role, branchId: staff.branchId },
    { expiresIn: "8h" },
  );

  return { 
    token, 
    staff: { 
      id: staff.id, 
      name: staff.name, 
      email: staff.email,
      role: staff.role, 
      branchId: staff.branchId,
      mustChangePassword: staff.mustChangePassword
    } 
  };
}

export async function me(req: FastifyRequest) {
  return authService.getStaffProfile(req.user.sub);
}

export async function changePassword(req: FastifyRequest, reply: FastifyReply) {
  const body = changePasswordSchema.parse(req.body);
  // req.user.sub comes from the authenticated token
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