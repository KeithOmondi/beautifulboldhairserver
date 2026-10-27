import type { FastifyReply, FastifyRequest } from "fastify";
import * as staffService from "./staff.service";
import { createStaffSchema, updateStaffSchema } from "./staff.schema";

export async function list(req: FastifyRequest, reply: FastifyReply) {
  return staffService.listStaff(req.user.branchId);
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const data = createStaffSchema.parse(req.body);
  const staff = await staffService.createStaff(req.user.branchId, data);
  return reply.status(201).send(staff);
}

export async function update(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const data = updateStaffSchema.parse(req.body);
  return staffService.updateStaff(req.user.branchId, id, data);
}

export async function remove(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  return staffService.deactivateStaff(req.user.branchId, id);
}