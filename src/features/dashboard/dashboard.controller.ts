import type { FastifyReply, FastifyRequest } from "fastify";
import * as dashboardService from "./dashboard.service";
import { getDashboardQuerySchema } from "./dashboard.schema";

/**
 * GET /api/v1/dashboard
 */
export async function get(req: FastifyRequest, reply: FastifyReply) {
  // Optional: If we want to support historical queries later, 
  // we validate the query string here.
  const { month } = getDashboardQuerySchema.parse(req.query);

  const summary = await dashboardService.getDashboard(req.user.branchId, month);
  return reply.send(summary);
}