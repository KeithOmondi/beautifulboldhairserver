import type { FastifyReply, FastifyRequest } from "fastify";
import * as serviceService from "./service.service";
import { 
  createServiceSchema, 
  updateServiceSchema, 
  createCommissionOverrideSchema 
} from "./service.schema";

/**
 * GET /api/v1/services
 */
export async function list(req: FastifyRequest, reply: FastifyReply) {
  const { includeInactive } = req.query as { includeInactive?: string };
  const services = await serviceService.listServices(
    req.user.branchId, 
    includeInactive === "true"
  );
  return reply.send(services);
}

/**
 * POST /api/v1/services
 */
export async function create(req: FastifyRequest, reply: FastifyReply) {
  const data = createServiceSchema.parse(req.body);
  const service = await serviceService.createService(req.user.branchId, data);
  return reply.status(201).send(service);
}

/**
 * PATCH /api/v1/services/:id
 */
export async function update(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const data = updateServiceSchema.parse(req.body);
  
  const service = await serviceService.updateService(req.user.branchId, id, data);
  return reply.send(service);
}

/**
 * DELETE /api/v1/services/:id
 */
export async function remove(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const result = await serviceService.deactivateService(req.user.branchId, id);
  return reply.send(result);
}

/**
 * POST /api/v1/services/commission-override
 */
export async function setOverride(req: FastifyRequest, reply: FastifyReply) {
  const data = createCommissionOverrideSchema.parse(req.body);
  const override = await serviceService.setCommissionOverride(req.user.branchId, data);
  return reply.status(201).send(override);
}

/**
 * DELETE /api/v1/services/commission-override?staffId=...&serviceId=...
 */
export async function removeOverride(req: FastifyRequest, reply: FastifyReply) {
  const { staffId, serviceId } = req.query as { staffId: string; serviceId: string };
  
  if (!staffId || !serviceId) {
    return reply.status(400).send({ error: "BAD_REQUEST", message: "staffId and serviceId are required" });
  }

  const result = await serviceService.removeCommissionOverride(req.user.branchId, staffId, serviceId);
  return reply.send(result);
}