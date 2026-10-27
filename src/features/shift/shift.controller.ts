import type { FastifyReply, FastifyRequest } from "fastify";
import * as shiftService from "./shift.service";
import { 
  createShiftSchema, 
  createRecurringShiftSchema, 
  createBreakSchema, 
  updateShiftSchema 
} from "./shift.schema";

/**
 * GET /api/v1/shifts/:staffId?from=...&to=...
 */
export async function list(req: FastifyRequest, reply: FastifyReply) {
  const { staffId } = req.params as { staffId: string };
  const { from, to } = req.query as { from?: string; to?: string };
  
  const shifts = await shiftService.listShifts(staffId, req.user.branchId, from, to);
  return reply.send(shifts);
}

/**
 * POST /api/v1/shifts
 */
export async function create(req: FastifyRequest, reply: FastifyReply) {
  const data = createShiftSchema.parse(req.body);
  const shift = await shiftService.createShift(req.user.branchId, data);
  return reply.status(201).send(shift);
}

/**
 * POST /api/v1/shifts/recurring
 */
export async function createRecurring(req: FastifyRequest, reply: FastifyReply) {
  const data = createRecurringShiftSchema.parse(req.body);
  const result = await shiftService.createRecurringShifts(req.user.branchId, data);
  return reply.status(201).send(result);
}

/**
 * POST /api/v1/shifts/:shiftId/breaks
 */
export async function addBreak(req: FastifyRequest, reply: FastifyReply) {
  const { shiftId } = req.params as { shiftId: string };
  const data = createBreakSchema.parse({ ...req.body as object, shiftId });
  
  const shiftBreak = await shiftService.addBreak(req.user.branchId, shiftId, data);
  return reply.status(201).send(shiftBreak);
}

/**
 * PATCH /api/v1/shifts/:shiftId
 */
export async function update(req: FastifyRequest, reply: FastifyReply) {
  const { shiftId } = req.params as { shiftId: string };
  const data = updateShiftSchema.parse(req.body);
  
  const shift = await shiftService.updateShift(req.user.branchId, shiftId, data);
  return reply.send(shift);
}

/**
 * DELETE /api/v1/shifts/:shiftId
 */
export async function remove(req: FastifyRequest, reply: FastifyReply) {
  const { shiftId } = req.params as { shiftId: string };
  const result = await shiftService.deleteShift(req.user.branchId, shiftId);
  return reply.send(result);
}