import type { FastifyReply, FastifyRequest } from "fastify";
import * as staffService from "./staff.service";
import { accessFor } from "../../utils/access";
import { createStaffSchema, updateStaffSchema } from "./staff.schema";

const idOf = (req: FastifyRequest) => (req.params as { id: string }).id;

export async function list(req: FastifyRequest, reply: FastifyReply) {
  const access = await accessFor(req.user);
  // An owner who works across branches can see the whole team at once, grouped by branch.
  if ((req.query as { all?: string }).all === "1") {
    if (req.user.role !== "OWNER" || !req.user.canSwitchBranches) return reply.status(403).send({ error: "FORBIDDEN", message: "Only an owner who manages all branches can see every branch's team" });
    return reply.send(await staffService.listAllStaff());
  }
  const all = await staffService.listStaff(req.user.branchId);
  if (req.user.role === "OWNER") return reply.send(all);
  // A manager sees the team, but pay only if the owner allows it.
  if (req.user.role === "MANAGER") return reply.send(access.staffPay ? all : all.map((s) => staffService.withoutPay(s)));
  // Everyone else needs names for the calendar, not colleagues' pay or contact details.
  return reply.send(all.map((s) => ({ id: s.id, name: s.name, title: s.title, role: s.role, isActive: s.isActive, isBookable: s.isBookable, serviceIds: s.serviceIds })));
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const data = createStaffSchema.parse(req.body);
  return reply.status(201).send(await staffService.createStaff(req.user.branchId, data, req.user.role, Boolean(req.user.canSwitchBranches), (await accessFor(req.user)).staffPay));
}

export async function update(req: FastifyRequest, reply: FastifyReply) {
  const data = updateStaffSchema.parse(req.body);
  return reply.send(await staffService.updateStaff(req.user.branchId, idOf(req), data, req.user.role, req.user.sub, Boolean(req.user.canSwitchBranches), (await accessFor(req.user)).staffPay));
}

export async function resetPassword(req: FastifyRequest, reply: FastifyReply) {
  return reply.send(await staffService.resetStaffPassword(req.user.branchId, idOf(req), req.user.role));
}

export async function remove(req: FastifyRequest, reply: FastifyReply) {
  return reply.send(await staffService.deactivateStaff(req.user.branchId, idOf(req), req.user.sub, req.user.role));
}
