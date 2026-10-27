import type { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/auth.middleware";
import { branchScope } from "../../middleware/branch-scope";
import { authorize } from "../../middleware/role.middleware";
import * as controller from "./service.controller";
import { Role } from "../../generated/prisma/client";

export async function serviceRoutes(app: FastifyInstance) {
  // All service routes require authentication and branch scoping
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", branchScope);

  // Only OWNER and MANAGER can modify services
  const canManage = { preHandler: [authorize(Role.OWNER, Role.MANAGER)] };

  // Everyone can list services
  app.get("/", controller.list);

  // Only managers can create, update, delete
  app.post("/", canManage, controller.create);
  app.patch("/:id", canManage, controller.update);
  app.delete("/:id", canManage, controller.remove);

  // Commission overrides
  app.post("/commission-override", canManage, controller.setOverride);
  app.delete("/commission-override", canManage, controller.removeOverride);
}