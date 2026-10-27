import type { FastifyReply, FastifyRequest } from "fastify";
import * as paymentService from "./payment.service";
import { createPaymentSchema } from "./payment.schema";

/**
 * POST /api/v1/payments
 */
export async function create(req: FastifyRequest, reply: FastifyReply) {
  const data = createPaymentSchema.parse(req.body);
  const payment = await paymentService.createPayment(req.user.branchId, data);
  return reply.status(201).send(payment);
}

/**
 * GET /api/v1/payments?date=YYYY-MM-DD
 */
export async function list(req: FastifyRequest, reply: FastifyReply) {
  const { date } = req.query as { date?: string };
  const payments = await paymentService.listPayments(req.user.branchId, date);
  return reply.send(payments);
}

/**
 * POST /api/v1/payments/:id/refund
 */
export async function refund(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const result = await paymentService.refundPayment(req.user.branchId, id);
  return reply.send(result);
}