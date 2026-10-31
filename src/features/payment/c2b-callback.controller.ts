import type { FastifyReply, FastifyRequest } from "fastify";
import { handleC2BCallback, listPendingPayments, assignPendingPayment } from "./c2b-callback.service";
import { prisma } from "../../config/db";
import { env } from "../../config/env";
import { z } from "zod";

export async function c2bCallback(req: FastifyRequest, reply: FastifyReply) {
  if (env.MPESA_CALLBACK_SECRET && (req.query as { secret?: string }).secret !== env.MPESA_CALLBACK_SECRET) {
    return reply.status(403).send({ ResultCode: 1, ResultDesc: "Forbidden" });
  }
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
/** Mark an unassigned payment as handled (e.g. refunded outside the system). */
export async function dismiss(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const found = await prisma.pendingPayment.findFirst({ where: { id, branchId: req.user.branchId, isAssigned: false } });
  if (!found) return reply.status(404).send({ error: "NOT_FOUND", message: "Payment not found or already handled" });
  await prisma.pendingPayment.update({ where: { id }, data: { isAssigned: true } });
  return reply.send({ message: "Marked as handled" });
}
