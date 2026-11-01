import type { FastifyReply, FastifyRequest } from "fastify";
import * as staffService from "./staff.service";
import { accessFor, departmentOf } from "../../utils/access";
import { prisma } from "../../config/db";
import { createStaffSchema, updateStaffSchema } from "./staff.schema";

const idOf = (req: FastifyRequest) => (req.params as { id: string }).id;

export async function list(req: FastifyRequest, reply: FastifyReply) {
  const access = await accessFor(req.user);
  // An owner who works across branches can see the whole team at once, grouped by branch.
  if ((req.query as { all?: string }).all === "1") {
    if (req.user.role !== "OWNER" || !req.user.canSwitchBranches) return reply.status(403).send({ error: "FORBIDDEN", message: "Only an owner who manages all branches can see every branch's team" });
    return reply.send(await staffService.listAllStaff());
  }
  let all = await staffService.listStaff(req.user.branchId);
  // Someone who looks after one side only sees stylists who do that side's services (or all services), and front-desk people of the same side.
  const dept = departmentOf(req.user);
  if (dept) {
    const mine = new Set((await prisma.service.findMany({ where: { branchId: req.user.branchId, category: dept }, select: { id: true } })).map((s) => s.id));
    all = all.filter((s) => (s.role === "WORKER" ? s.serviceIds.length === 0 || s.serviceIds.some((id) => mine.has(id)) : s.role === "OWNER" || s.department === null || s.department === dept));
  }
  if (req.user.role === "OWNER") return reply.send(all);
  // A manager sees the team, but pay only if the owner allows it.
  if (req.user.role === "MANAGER") return reply.send(access.staffPay ? all : all.map((s) => staffService.withoutPay(s)));
  // Everyone else needs names for the calendar, not colleagues' pay or contact details.
  return reply.send(all.map((s) => ({ id: s.id, name: s.name, title: s.title, role: s.role, isActive: s.isActive, isBookable: s.isBookable, serviceIds: s.serviceIds })));
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const data = createStaffSchema.parse(req.body);
  return reply.status(201).send(await staffService.createStaff(req.user.branchId, data, req.user.role, Boolean(req.user.canSwitchBranches), (await accessFor(req.user)).staffPay, departmentOf(req.user)));
}

export async function update(req: FastifyRequest, reply: FastifyReply) {
  const data = updateStaffSchema.parse(req.body);
  return reply.send(await staffService.updateStaff(req.user.branchId, idOf(req), data, req.user.role, req.user.sub, Boolean(req.user.canSwitchBranches), (await accessFor(req.user)).staffPay, departmentOf(req.user)));
}

export async function resetPassword(req: FastifyRequest, reply: FastifyReply) {
  return reply.send(await staffService.resetStaffPassword(req.user.branchId, idOf(req), req.user.role, departmentOf(req.user)));
}

export async function remove(req: FastifyRequest, reply: FastifyReply) {
  return reply.send(await staffService.deactivateStaff(req.user.branchId, idOf(req), req.user.sub, req.user.role, departmentOf(req.user)));
}
