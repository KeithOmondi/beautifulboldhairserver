import type { FastifyReply, FastifyRequest } from "fastify";
import { handleC2BCallback, listPendingPayments, assignPendingPayment } from "./c2b-callback.service";
import { prisma } from "../../config/db";
import { z } from "zod";

export async function c2bCallback(req: FastifyRequest, reply: FastifyReply) {
  const payload = req.body as any;
  
  const branch = await prisma.branch.findFirst({ where: { isActive: true } });
  if (!branch) return reply.send({ ResultCode: 0, ResultDesc: "No Branch" });

  try {
    const result = await handleC2BCallback(branch.id, payload);
    return reply.send(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    req.log.error({ err: errorMessage }, "C2B Callback Error");
    return reply.send({ ResultCode: 0, ResultDesc: "Accepted" });
  }
}

export async function listPending(req: FastifyRequest, reply: FastifyReply) {
  const pending = await listPendingPayments(req.user.branchId);
  return reply.send(pending);
}

const assignSchema = z.object({
  pendingId: z.string().cuid(),
  bookingId: z.string().cuid(),
});

export async function assign(req: FastifyRequest, reply: FastifyReply) {
  const { pendingId, bookingId } = assignSchema.parse(req.body);
  const result = await assignPendingPayment(req.user.branchId, pendingId, bookingId);
  return reply.send(result);
}