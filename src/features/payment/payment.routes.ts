import type { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/auth.middleware";
import { branchScope } from "../../middleware/branch-scope";
import { authorize } from "../../middleware/role.middleware";
import * as controller from "./payment.controller";
import { Role } from "../../generated/prisma/client";

export async function paymentRoutes(app: FastifyInstance) {
  // All payment routes require authentication and branch scoping
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", branchScope);

  // Only front-desk staff and managers can handle money
  const canManage = { 
    preHandler: [authorize(Role.OWNER, Role.MANAGER, Role.RECEPTIONIST)] 
  };

  // List payments (for daily reports)
  app.get("/", canManage, controller.list);

  // Record and refund payments
  app.post("/", canManage, controller.create);
  app.post("/:id/refund", canManage, controller.refund);
}