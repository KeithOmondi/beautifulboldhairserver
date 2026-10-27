import type { FastifyReply, FastifyRequest } from "fastify";
import * as payrollService from "./payroll.service";
import { generatePayrollSchema, createAdjustmentSchema } from "./payroll.schema";

/**
 * POST /api/v1/payroll/runs
 */
export async function generate(req: FastifyRequest, reply: FastifyReply) {
  const data = generatePayrollSchema.parse(req.body);
  const run = await payrollService.generatePayroll(req.user.branchId, data);
  return reply.status(201).send(run);
}

/**
 * GET /api/v1/payroll/runs
 */
export async function list(req: FastifyRequest, reply: FastifyReply) {
  const runs = await payrollService.listPayrollRuns(req.user.branchId);
  return reply.send(runs);
}

/**
 * POST /api/v1/payroll/runs/:runId/adjustments
 */
export async function addAdjustment(req: FastifyRequest, reply: FastifyReply) {
  const { runId } = req.params as { runId: string };
  const data = createAdjustmentSchema.parse(req.body);
  
  const line = await payrollService.addAdjustment(req.user.branchId, runId, data);
  return reply.status(201).send(line);
}

/**
 * POST /api/v1/payroll/runs/:runId/approve
 */
export async function approve(req: FastifyRequest, reply: FastifyReply) {
  const { runId } = req.params as { runId: string };
  const run = await payrollService.approvePayroll(req.user.branchId, runId, req.user.sub);
  return reply.send(run);
}