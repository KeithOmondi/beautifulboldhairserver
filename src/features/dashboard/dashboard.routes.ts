import type { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/auth.middleware";
import { branchScope } from "../../middleware/branch-scope";
import { authorize } from "../../middleware/role.middleware";
import * as controller from "./dashboard.controller";
import { Role } from "../../generated/prisma/client";
import { requires } from "../../utils/access";

export async function dashboardRoutes(app: FastifyInstance) {
  // All dashboard routes require authentication and branch scoping
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", branchScope);

  // Only OWNER and MANAGER can view business analytics
  app.get(
    "/", 
    { preHandler: [authorize(Role.OWNER, Role.MANAGER), requires("reports")] }, 
    controller.get
  );
}