import type { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/auth.middleware";
import { branchScope } from "../../middleware/branch-scope";
import { authorize } from "../../middleware/role.middleware";
import * as controller from "./cash-up.controller";
import { Role } from "../../generated/prisma/client";
import { requires } from "../../utils/access";

export async function cashUpRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", branchScope);

  const canManage = { 
    preHandler: [authorize(Role.OWNER, Role.MANAGER, Role.RECEPTIONIST)] 
  };
  
  // Only OWNER/MANAGER can approve (lock) the day
  const canApprove = { 
    preHandler: [authorize(Role.OWNER, Role.MANAGER), requires("cashUp")] 
  };

  app.get("/", canManage, controller.list);
  app.post("/", canManage, controller.create);
  app.post("/:id/approve", canApprove, controller.approve);
}