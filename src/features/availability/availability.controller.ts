import type { FastifyReply, FastifyRequest } from "fastify";
import * as availabilityService from "./availability.service";
import { getAvailabilitySchema } from "./availability.schema";

/**
 * GET /api/v1/availability?staffId=...&date=...&serviceId=...
 */
export async function getSlots(req: FastifyRequest, reply: FastifyReply) {
  // 1. Validate the query parameters
  const query = getAvailabilitySchema.parse(req.query);
  
  // 2. Call the engine
  const result = await availabilityService.getAvailableSlots(req.user.branchId, query);
  
  // 3. Return the result
  return reply.send(result);
}