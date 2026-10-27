import type { FastifyReply, FastifyRequest } from "fastify";
import * as publicBookingService from "./public-booking.service";
import { 
  requestOtpSchema, 
  verifyOtpSchema, 
  holdSlotSchema, 
  confirmPublicBookingSchema 
} from "./public-booking.schema";
import { AppError } from "../../utils/errors";
import { prisma } from "../../config/db";

/**
 * POST /api/v1/public/request-otp
 */
export async function requestOtp(req: FastifyRequest, reply: FastifyReply) {
  const { phone } = requestOtpSchema.parse(req.body);
  const result = await publicBookingService.requestClientOtp(phone);
  return reply.send(result);
}

/**
 * POST /api/v1/public/verify-otp
 */
export async function verifyOtp(req: FastifyRequest, reply: FastifyReply) {
  const data = verifyOtpSchema.parse(req.body);
  const result = await publicBookingService.verifyClientOtp(req.server, data);
  return reply.send(result);
}

/**
 * POST /api/v1/public/hold-slot
 * Requires: Client JWT (Authorization: Bearer <token>)
 */
export async function holdSlot(req: FastifyRequest, reply: FastifyReply) {
  const data = holdSlotSchema.parse(req.body);
  
  // FIX: Use `as unknown as` to bypass the staff AuthUser type inference
  const user = req.user as unknown as { type: string; phone: string; clientId: string | null };
  
  if (!user || user.type !== "client") {
    throw new AppError(401, "Unauthorized: Client token required", "UNAUTHORIZED");
  }

  const branch = await prisma.branch.findFirst({ where: { isActive: true } });
  if (!branch) throw new AppError(500, "Salon is not currently accepting bookings", "NO_BRANCH");

  const result = await publicBookingService.holdSlot(branch.id, user.phone, data);
  return reply.status(201).send(result);
}

/**
 * POST /api/v1/public/confirm
 * Requires: Client JWT (Authorization: Bearer <token>)
 */
export async function confirmBooking(req: FastifyRequest, reply: FastifyReply) {
  const data = confirmPublicBookingSchema.parse(req.body);
  
  // FIX: Use `as unknown as` here as well
  const user = req.user as unknown as { type: string; phone: string; clientId: string | null };
  
  if (!user || user.type !== "client") {
    throw new AppError(401, "Unauthorized: Client token required", "UNAUTHORIZED");
  }

  const branch = await prisma.branch.findFirst({ where: { isActive: true } });
  if (!branch) throw new AppError(500, "Salon is not currently accepting bookings", "NO_BRANCH");

  const result = await publicBookingService.confirmPublicBooking(branch.id, user.phone, data);
  return reply.status(201).send(result);
}