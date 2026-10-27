import type { FastifyReply, FastifyRequest } from "fastify";
import * as clientService from "./client.service";
import { createClientSchema, updateClientSchema } from "./client.schema";

/**
 * GET /api/v1/clients?search=mary
 */
export async function list(req: FastifyRequest, reply: FastifyReply) {
  const { search } = req.query as { search?: string };
  const clients = await clientService.listClients(req.user.branchId, search);
  return reply.send(clients);
}

/**
 * GET /api/v1/clients/:id
 */
export async function getById(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const client = await clientService.getClientById(req.user.branchId, id);
  return reply.send(client);
}

/**
 * POST /api/v1/clients
 */
export async function create(req: FastifyRequest, reply: FastifyReply) {
  const data = createClientSchema.parse(req.body);
  const client = await clientService.createClient(req.user.branchId, data);
  return reply.status(201).send(client);
}

/**
 * PATCH /api/v1/clients/:id
 */
export async function update(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const data = updateClientSchema.parse(req.body);
  
  const client = await clientService.updateClient(req.user.branchId, id, data);
  return reply.send(client);
}