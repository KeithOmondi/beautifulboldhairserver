import type { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/auth.middleware";
import { branchScope } from "../../middleware/branch-scope";
import { authorize } from "../../middleware/role.middleware";
import * as controller from "./client.controller";
import { Role } from "../../generated/prisma/client";

export async function clientRoutes(app: FastifyInstance) {
  // All client routes require authentication and branch scoping
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", branchScope);

  // Only front-desk staff can create/update clients
  const canManage = { 
    preHandler: [authorize(Role.OWNER, Role.MANAGER, Role.RECEPTIONIST)] 
  };

  // Everyone can view the client list and individual clients
  // Contact details are limited to front-desk roles; stylists use the calendar instead.
  app.get("/", canManage, controller.list);
  app.get("/:id", canManage, controller.getById);

  // Only front-desk staff can create or update
  app.post("/", canManage, controller.create);
  app.patch("/:id", canManage, controller.update);
}