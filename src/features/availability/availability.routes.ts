import type { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/auth.middleware";
import { branchScope } from "../../middleware/branch-scope";
import * as controller from "./availability.controller";

export async function availabilityRoutes(app: FastifyInstance) {
  // All availability checks require authentication and branch scoping
  // (We will create a separate "public" availability route later for clients)
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", branchScope);

  app.get("/", controller.getSlots);
}