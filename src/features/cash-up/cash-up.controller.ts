import type { FastifyReply, FastifyRequest } from "fastify";
import * as cashUpService from "./cash-up.service";
import { createCashUpSchema } from "./cash-up.schema";

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const data = createCashUpSchema.parse(req.body);
  const cashUp = await cashUpService.createCashUp(req.user.branchId, data);
  return reply.status(201).send(cashUp);
}

export async function list(req: FastifyRequest, reply: FastifyReply) {
  const cashUps = await cashUpService.listCashUps(req.user.branchId);
  return reply.send(cashUps);
}

export async function approve(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const cashUp = await cashUpService.approveCashUp(req.user.branchId, id, req.user.sub);
  return reply.send(cashUp);
}